import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInvocationShape, PRIOR_RECEIPT_LIMITS } from '../oats-package/capabilities/oats-okf/lib/invocation-shape.mjs';
import { invocationFor, helperSubject, persistentSubject } from './helpers/invocation-fixture.mjs';
const binding={capability:'example.provider'},context={kind:'standalone',key:'fixture'},action={kind:'hook',capability:'example.provider',name:'spawn'};
const make=(subject=persistentSubject())=>invocationFor({binding,context,action,subject});

test('full subjects preserve persistent and helper artifact/definition identity',()=>{
  for(const subject of [persistentSubject(),helperSubject()]) assert.equal(validateInvocationShape(make(subject)).subject,subject);
  const helper=make(helperSubject());helper.subject.definition=structuredClone(helper.subject.definition);helper.subject.definition.owner.integrity.value=`sha256-${'f'.repeat(64)}`;
  assert.throws(()=>validateInvocationShape(helper),{code:'invalid-binding'});
  const persistent=make();persistent.subject.soul.sourceArtifact=structuredClone(persistent.subject.soul.sourceArtifact);persistent.subject.soul.sourceArtifact.identity.source='path:/other';
  assert.throws(()=>validateInvocationShape(persistent),{code:'invalid-binding'});
  for(const subject of [{kind:'helper',identity:null,alias:'helper'},{kind:'persistent',identity:{},alias:'example'}]) assert.throws(()=>validateInvocationShape({...make(),subject}),{code:'invalid-binding'});
});

test('closed invocation matches capability/context/action and instance subject/home',()=>{
  const value=make();assert.equal(validateInvocationShape(value,{capability:binding.capability,context,action}),value);
  for(const expected of [{capability:'other.provider'},{context:{kind:'standalone',key:'other'}},{action:{...action,name:'retire'}}]) assert.throws(()=>validateInvocationShape(value,expected),{code:'invalid-binding'});
  for(const changed of [{...value,extra:true},{...value,schemaVersion:2},{...value,instance:{...value.instance,agent:'other'}},{...value,instance:{...value.instance,work:'/other/work'}},{...value,action:{...action,unknown:true}},{...value,action:{kind:'hook',name:'spawn'}}]) assert.throws(()=>validateInvocationShape(changed),{code:'invalid-binding'});
  assert.doesNotThrow(()=>validateInvocationShape({...value,instance:null}));
});

test('prior opaque receipt has its own byte/depth/entry budget',()=>{
  const value=make(),limit=PRIOR_RECEIPT_LIMITS;
  assert.doesNotThrow(()=>validateInvocationShape({...value,priorReceipt:'x'.repeat(limit.bytes-2)}));
  assert.throws(()=>validateInvocationShape({...value,priorReceipt:'x'.repeat(limit.bytes)}),{code:'invalid-binding'});
  let deep=null;for(let i=0;i<limit.depth+1;i++) deep=[deep];
  assert.throws(()=>validateInvocationShape({...value,priorReceipt:deep}),{code:'invalid-binding'});
  assert.throws(()=>validateInvocationShape({...value,priorReceipt:Array(limit.entries+1).fill(null)}),{code:'invalid-binding'});
});

test('human must match disabled/enabled messaging choice; unknown or invented fields refuse',()=>{
  const value=make();assert.equal(value.responsibleHuman,null);
  assert.throws(()=>validateInvocationShape({...value,responsibleHuman:{provider:'example.messaging',id:'human'}}),{code:'invalid-binding'});
  const human={provider:'example.messaging',id:'human'};
  const enabled={...value,responsibleHuman:human,messagingChoice:{schemaVersion:1,enabled:true,privateKey:{provider:'example.messaging',human,context},wider:[],provenance:[]}};
  assert.doesNotThrow(()=>validateInvocationShape(enabled));
  assert.throws(()=>validateInvocationShape({...enabled,context:{kind:'standalone',key:'wrong'}}),{code:'invalid-binding'});
  assert.throws(()=>validateInvocationShape({...enabled,incarnationId:'invented'}),{code:'invalid-binding'});
});
