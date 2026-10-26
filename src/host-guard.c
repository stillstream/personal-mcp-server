#define _GNU_SOURCE
#include <linux/landlock.h>
#include <linux/seccomp.h>
#include <linux/filter.h>
#include <linux/audit.h>
#include <sys/syscall.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <fcntl.h>
#include <unistd.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>

/* Stable UAPI values permit old userspace headers with a newer runtime kernel. */
#ifndef LANDLOCK_ACCESS_FS_REFER
#define LANDLOCK_ACCESS_FS_REFER (1ULL << 13)
#endif
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif
#ifndef LANDLOCK_ACCESS_NET_BIND_TCP
#define LANDLOCK_ACCESS_NET_BIND_TCP (1ULL << 0)
#define LANDLOCK_ACCESS_NET_CONNECT_TCP (1ULL << 1)
#endif
struct guard_net_port {uint64_t allowed_access,port;};
/* Trusted launcher arguments only. No model-controlled rule or command surface. */
struct rules_v6 { uint64_t fs, net, scoped; };
static void die(const char *m){perror(m);exit(125);}
static int number(const char *s){char *end;long n=strtol(s,&end,10);if(!*s||*end||n<1||n>65535){errno=EINVAL;die("INVALID_PORT");}return (int)n;}
static void path_rule(int fd,const char *p,uint64_t rights){if(p[0]!='/'){errno=EINVAL;die("ABSOLUTE_PATH_REQUIRED");}int f=open(p,O_PATH|O_CLOEXEC);if(f<0)die("RULE_PATH");struct stat s;if(fstat(f,&s))die("RULE_STAT");if(!S_ISDIR(s.st_mode))rights&=LANDLOCK_ACCESS_FS_EXECUTE|LANDLOCK_ACCESS_FS_READ_FILE|LANDLOCK_ACCESS_FS_WRITE_FILE|LANDLOCK_ACCESS_FS_TRUNCATE;struct landlock_path_beneath_attr a={.allowed_access=rights,.parent_fd=f};if(syscall(SYS_landlock_add_rule,fd,LANDLOCK_RULE_PATH_BENEATH,&a,0))die("PATH_RULE");close(f);}
static void port_rule(int fd,int port,uint64_t right){struct guard_net_port a={.allowed_access=right,.port=(uint64_t)port};if(syscall(SYS_landlock_add_rule,fd,2 /* LANDLOCK_RULE_NET_PORT */,&a,0))die("PORT_RULE");}
#define STMT(c,k) ((struct sock_filter)BPF_STMT(c,k))
#define JUMP(c,k,t,f) ((struct sock_filter)BPF_JUMP(c,k,t,f))
static void seccomp_guard(void){struct sock_filter f[256];int n=0;uint32_t self=(uint32_t)getpid();
#define ADD(x) f[n++]=(x)
#define DENY(sys) do{ADD(JUMP(BPF_JMP|BPF_JEQ|BPF_K,(sys),0,1));ADD(STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM));}while(0)
 ADD(STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,arch)));ADD(JUMP(BPF_JMP|BPF_JEQ|BPF_K,AUDIT_ARCH_X86_64,1,0));ADD(STMT(BPF_RET|BPF_K,SECCOMP_RET_KILL_PROCESS));ADD(STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,nr)));ADD(JUMP(BPF_JMP|BPF_JSET|BPF_K,0x40000000,0,1));ADD(STMT(BPF_RET|BPF_K,SECCOMP_RET_KILL_PROCESS));
 DENY(SYS_ptrace);DENY(SYS_process_vm_readv);DENY(SYS_process_vm_writev);DENY(SYS_pidfd_getfd);DENY(SYS_unshare);DENY(SYS_setns);DENY(SYS_mount);DENY(SYS_umount2);DENY(SYS_pivot_root);DENY(SYS_chroot);DENY(SYS_bpf);DENY(SYS_perf_event_open);DENY(SYS_open_by_handle_at);DENY(SYS_io_uring_setup);DENY(SYS_io_uring_enter);DENY(SYS_io_uring_register);DENY(SYS_userfaultfd);DENY(SYS_init_module);DENY(SYS_finit_module);DENY(SYS_delete_module);DENY(SYS_kexec_load);DENY(SYS_reboot);DENY(SYS_swapon);DENY(SYS_swapoff);
 /* ABI4 has no signal scope: forbid external process signals on every ABI. */
#define SELF_SIGNAL(sys) do{ADD(JUMP(BPF_JMP|BPF_JEQ|BPF_K,(sys),0,4));ADD(STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[0])));ADD(JUMP(BPF_JMP|BPF_JEQ|BPF_K,self,1,0));ADD(STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM));ADD(STMT(BPF_RET|BPF_K,SECCOMP_RET_ALLOW));}while(0)
 SELF_SIGNAL(SYS_kill);SELF_SIGNAL(SYS_tkill);SELF_SIGNAL(SYS_tgkill);SELF_SIGNAL(SYS_rt_sigqueueinfo);SELF_SIGNAL(SYS_rt_tgsigqueueinfo);DENY(SYS_pidfd_send_signal);
 /* Connected local stream pairs support runtime IPC, never unbound Unix sockets. */
 ADD(JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_socketpair,0,11));ADD(STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[0])));ADD(JUMP(BPF_JMP|BPF_JEQ|BPF_K,AF_UNIX,1,0));ADD(STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM));ADD(STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[1])));ADD(STMT(BPF_ALU|BPF_AND|BPF_K,0xf));ADD(JUMP(BPF_JMP|BPF_JEQ|BPF_K,SOCK_STREAM,1,0));ADD(STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM));ADD(STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[2])));ADD(JUMP(BPF_JMP|BPF_JEQ|BPF_K,0,1,0));ADD(STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM));ADD(STMT(BPF_RET|BPF_K,SECCOMP_RET_ALLOW));
 /* Only IPv4/IPv6 stream sockets; Landlock gates TCP connect/bind ports. */
 ADD(JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_socket,0,9));ADD(STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[0])));ADD(JUMP(BPF_JMP|BPF_JEQ|BPF_K,AF_INET,2,0));ADD(JUMP(BPF_JMP|BPF_JEQ|BPF_K,AF_INET6,1,0));ADD(STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM));ADD(STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[1])));ADD(STMT(BPF_ALU|BPF_AND|BPF_K,0xf));ADD(JUMP(BPF_JMP|BPF_JEQ|BPF_K,SOCK_STREAM,1,0));ADD(STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM));ADD(STMT(BPF_RET|BPF_K,SECCOMP_RET_ALLOW));
 ADD(STMT(BPF_RET|BPF_K,SECCOMP_RET_ALLOW));struct sock_fprog prog={.len=(unsigned short)n,.filter=f};if(prctl(PR_SET_SECCOMP,SECCOMP_MODE_FILTER,&prog))die("SECCOMP_REQUIRED");
}
int main(int argc,char **argv){int abi=syscall(SYS_landlock_create_ruleset,NULL,0,LANDLOCK_CREATE_RULESET_VERSION);if(argc==2&&!strcmp(argv[1],"--abi")){printf("%d\n",abi);return abi>=4?0:125;}if(abi<4){errno=ENOTSUP;die("LANDLOCK_ABI_4_REQUIRED");}
 if(syscall(SYS_close_range,3,~0U,0)){die("CLOSE_INHERITED_FDS");}
 struct rlimit core={0,0};if(setrlimit(RLIMIT_CORE,&core))die("NO_CORE_DUMPS");uint64_t read=LANDLOCK_ACCESS_FS_READ_FILE|LANDLOCK_ACCESS_FS_READ_DIR,write=read|LANDLOCK_ACCESS_FS_WRITE_FILE|LANDLOCK_ACCESS_FS_REMOVE_DIR|LANDLOCK_ACCESS_FS_REMOVE_FILE|LANDLOCK_ACCESS_FS_MAKE_DIR|LANDLOCK_ACCESS_FS_MAKE_REG|LANDLOCK_ACCESS_FS_MAKE_SYM|LANDLOCK_ACCESS_FS_REFER|LANDLOCK_ACCESS_FS_TRUNCATE;
 struct rules_v6 a={.fs=(1ULL<<15)-1,.net=LANDLOCK_ACCESS_NET_BIND_TCP|LANDLOCK_ACCESS_NET_CONNECT_TCP,.scoped=abi>=6?3:0};int fd=syscall(SYS_landlock_create_ruleset,&a,sizeof(a),0);if(fd<0)die("RULESET_REQUIRED");int i=1;for(;i<argc;i++){if(!strcmp(argv[i],"--")){i++;break;}if(i+1>=argc){errno=EINVAL;die("MISSING_RULE_VALUE");}const char *k=argv[i++],*v=argv[i];if(!strcmp(k,"--read"))path_rule(fd,v,read);else if(!strcmp(k,"--write"))path_rule(fd,v,write);else if(!strcmp(k,"--exec"))path_rule(fd,v,read|LANDLOCK_ACCESS_FS_EXECUTE);else if(!strcmp(k,"--connect"))port_rule(fd,number(v),LANDLOCK_ACCESS_NET_CONNECT_TCP);else if(!strcmp(k,"--bind"))port_rule(fd,number(v),LANDLOCK_ACCESS_NET_BIND_TCP);else{errno=EINVAL;die("UNKNOWN_RULE");}}
 if(i>=argc||argv[i][0]!='/'){errno=EINVAL;die("ABSOLUTE_EXEC_REQUIRED");}if(prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0))die("NO_NEW_PRIVS_REQUIRED");if(syscall(SYS_landlock_restrict_self,fd,0))die("LANDLOCK_REQUIRED");close(fd);seccomp_guard();execv(argv[i],&argv[i]);die("EXEC_DENIED");return 125;
}
