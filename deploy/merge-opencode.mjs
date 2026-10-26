#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
import { modelConfig } from '../src/instance-config.mjs';

// Only the project's selected target profile supplies model/API credentials.
// Snapshots retain non-model settings, never a second authoritative provider source.
export async function mergeInstanceModels(original, instance, target, container) {
 const profile = await modelConfig(instance, target, container);
 const merged = structuredClone(original);
 delete merged.providers; delete merged.package;
 merged.provider = structuredClone(profile.provider);
 merged.model = profile.model;
 if (profile.small_model) merged.small_model = profile.small_model; else delete merged.small_model;
 return merged;
}

export function mergeProviders(original,routes){
 if(original.providers||original.package||!original.provider)throw Error('UNSUPPORTED_OPENCODE_SCHEMA');
 const c=structuredClone(original);const ids=[['dlvins-vllm','Qwen3.8-27B-NVFP4-RTX5090','27b'],['dlvins-flashnext','qwen3.8-flash-next-local','flash']];
 for(const [provider,model,key]of ids){
  const url=new URL(routes[key]);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/v1'))throw Error('INVALID_ROUTER_URL');
  const p=c.provider[provider];if(!p?.models?.[model]||!p.options)throw Error('EXISTING_PROVIDER_REQUIRED');
  p.options.baseURL=url.toString().replace(/\/$/,'');
 }
 return c;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)){
 const [input,routes,output]=process.argv.slice(2);if(!input||!routes||!output||resolve(input)===resolve(output))throw Error('INPUT_ROUTES_NEW_OUTPUT_REQUIRED');
 const c=mergeProviders(JSON.parse(await readFile(input,'utf8')),JSON.parse(await readFile(routes,'utf8')));
 await writeFile(output,JSON.stringify(c,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log('Prepared separate OpenCode config; only two provider baseURLs changed. Existing running configuration untouched.');
}
