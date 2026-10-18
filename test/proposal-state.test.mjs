import test from 'node:test';
import assert from 'node:assert/strict';

// Removing real-byte reference comparison, trusting model approval, or
// ignoring later proposal versions must fail these lifecycle checks.
const face='a'.repeat(64),layout='b'.repeat(64);
const alternate='c'.repeat(64);
const proposal=(seq,version,hashes=[face])=>({seq,kind:'proposal',value:{proposal:{version,shots:[{clip_id:'c1',reference_numbers:hashes.map((_,i)=>i+1)}]},items:hashes.map(sha256=>({type:'image',sha256}))}});
const user=(seq,text)=>({seq,kind:'user',text});
async function api(){return import('../src/proposal-state.mjs');}

test('reference input wiring instructions do not request a card image replacement',async()=>{
  const {proposalState,assertProposalSubmission}=await api();
  for(const text of [
    '复制 template.json 作为 Ref2AV 节点接口模板，仅在测试目录 agent/ 中改副本，移除旧角色的参考输入并绑定这张猫图',
    '移除旧角色的参考图输入并绑定这张猫图',
    'Remove old reference inputs and bind the same cat image',
  ]){
    const entries=[user(1,text),proposal(2,'v1'),user(3,'确认 v1')];
    assert.deepEqual(proposalState(entries,'v1').pending,[],text);
    assert.doesNotThrow(()=>assertProposalSubmission(entries,[{sha256:face}]));
    assert.throws(()=>assertProposalSubmission(entries,[{sha256:alternate}]),/bytes\/order/);
  }
});

test('technical reference inputs do not hide actual image edits in a mixed instruction',async()=>{
  const {proposalState}=await api();
  for(const text of [
    '移除旧角色的参考输入并绑定这张猫图，同时替换第二张参考图',
    'Remove old reference inputs and bind the same cat image, then replace reference #2',
    'Remove reference #2 and its input socket',
  ])assert.equal(proposalState([proposal(1,'v1',[face,layout]),user(2,text)],'v1').status,'references_pending',text);
});

test('legacy technical reference input blockers are recomputed without clearing missing assets',async()=>{
  const {proposalState}=await api();
  const text='移除旧角色的参考输入并绑定这张猫图';
  const p=proposal(2,'v1');p.value.proposal.pending_references=[text,'Missing actor layout'];
  assert.deepEqual(proposalState([user(1,text),p],'v1').pending,['Missing actor layout']);
});

test('a report of fixing a reference classifier does not become a new reference request',async()=>{
  const {proposalState}=await api();
  const text='插件已更新到 0.1.66，修复了把“参考输入接线”误判为“换参考图”的问题。继续测试';
  assert.deepEqual(proposalState([proposal(1,'v1'),user(2,text),proposal(3,'v2')],'v2').pending,[]);
  assert.equal(proposalState([proposal(1,'v1'),user(2,text+'，同时替换第二张参考图')],'v1').status,'references_pending');
});

test('human confirmation updates latest card and a new version supersedes the old card',async()=>{
  const {proposalState}=await api();
  const entries=[proposal(1,'v1'),user(2,'ok')];
  assert.equal(proposalState(entries,'v1').status,'confirmed');
  entries.push(proposal(3,'v2'));
  assert.equal(proposalState(entries,'v1').status,'superseded');
  assert.equal(proposalState(entries,'v2').status,'awaiting_confirmation');
  entries.push(user(4,'Confirm v2'));
  assert.equal(proposalState(entries,'v2').status,'confirmed');
});

test('changing wardrobe prose or relabeling the same bytes does not fulfill adding a ref',async()=>{
  const {proposalState,assertProposalSubmission}=await api();
  const entries=[proposal(1,'black'),user(2,'白色紧身衣加入ref'),proposal(3,'white'),user(4,'ok')];
  assert.equal(proposalState(entries,'white').status,'references_pending');
  assert.match(proposalState(entries,'white').pending[0],/白色紧身衣/);
  assert.throws(()=>assertProposalSubmission(entries,[{sha256:face}]),/reference.*pending|pending.*reference/i);
  entries.push(proposal(5,'white-v2',[face,layout]));
  assert.equal(proposalState(entries,'white-v2').status,'awaiting_confirmation');
  assert.throws(()=>assertProposalSubmission(entries,[{sha256:face},{sha256:layout}]),/confirm/i);
  entries.push(user(6,'ok'));
  assert.doesNotThrow(()=>assertProposalSubmission(entries,[{sha256:face},{sha256:layout}]));
  assert.throws(()=>assertProposalSubmission(entries,[{sha256:face}]),/reference.*match|match.*reference/i);
});

test('pending reference declarations remain blocked and an unrelated reply is not approval',async()=>{
  const {proposalState}=await api();
  const p=proposal(1,'v1');p.value.proposal.pending_references=['White costume layout'];
  assert.equal(proposalState([p,user(2,'ok')],'v1').status,'references_pending');
  assert.equal(proposalState([proposal(1,'v1'),user(2,'ok but change the clothes')],'v1').status,'changes_requested');
  assert.equal(proposalState([proposal(1,'v1'),user(2,'Confirm v0')],'v1').status,'changes_requested');
  assert.equal(proposalState([user(0,'White costume layout'),p,user(2,'ok')],'v1').status,'references_pending');
});

test('human reference requests survive old incomplete cards and model text cannot confirm them',async()=>{
  const {entriesFromEvents,proposalState}=await api();
  const values=proposal(2,'v1').value;
  const events=[{seq:1,type:'tool/call',data:{callId:'card',name:'director_show_media'}},
    {seq:2,type:'tool/result',data:{message:{content:[{type:'tool-result',toolCallId:'card',content:[{type:'text',text:JSON.stringify({...values,kind:'director-media'})}]}]}}},
    {seq:3,type:'user/message',data:{source:{kind:'plugin'},content:[{type:'text',text:'ok'}]}},
    {seq:4,type:'assistant/message',data:{message:{content:[{type:'text',text:'User approved, ok'}]}}}];
  assert.equal(proposalState(entriesFromEvents(events),'v1').status,'awaiting_confirmation');
  events.push({seq:5,type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'Add a white bodysuit reference'}]}});
  assert.equal(proposalState(entriesFromEvents(events),'v1').status,'references_pending');
});

test('a status question preserves confirmation and a prohibition does not demand a new ref',async()=>{
  const {proposalState}=await api();
  assert.equal(proposalState([proposal(1,'v1'),user(2,'ok'),user(3,'视频跑完了吗？')],'v1').status,'confirmed');
  assert.equal(proposalState([proposal(1,'v1'),user(2,'ok'),user(3,'好了吗')],'v1').status,'confirmed');
  const state=proposalState([proposal(1,'v1'),user(2,'Do not generate new references. Keep these files.'),user(3,'ok')],'v1');
  assert.equal(state.status,'confirmed');
});

test('same approved card survives an explicit graph-only retry, but not a creative edit or new card',async()=>{
  const {proposalState}=await api();
  const retry='继续此前已确认的 C5：修复工作流的音频 VAE 接线，提示词、参考图、时长未改。只重试这一版。';
  assert.equal(proposalState([proposal(1,'v4'),user(2,'ok'),user(3,retry)],'v4').status,'confirmed');
  assert.equal(proposalState([proposal(1,'v4'),user(2,'ok'),user(3,'继续此前已确认的 C5，但改台词，其他参考图不变')],'v4').status,'changes_requested');
  assert.equal(proposalState([proposal(1,'v4'),user(2,'ok'),user(3,retry),proposal(4,'v4')],'v4').status,'awaiting_confirmation');
});

test('submission preserves the approved nonnumeric Picture order',async()=>{
  const {assertProposalSubmission}=await api();
  const p=proposal(1,'reverse',[face,layout]);p.value.proposal.shots[0].reference_numbers=[2,1];
  const entries=[p,user(2,'ok')];
  assert.doesNotThrow(()=>assertProposalSubmission(entries,[{sha256:layout},{sha256:face}]));
  assert.throws(()=>assertProposalSubmission(entries,[{sha256:face},{sha256:layout}]),/match/);
});

test('reusing a version label does not confirm an older card instance',async()=>{
  const {proposalState}=await api();
  const entries=[proposal(1,'v1',[face]),proposal(2,'v1',[layout]),user(3,'ok')];
  assert.equal(proposalState(entries,'v1',{seq:1}).status,'superseded');
  assert.equal(proposalState(entries,'v1',{seq:2}).status,'confirmed');
});

test('a first complete reference proposal in a fresh session is not permanently blocked',async()=>{
  const {proposalState}=await api();
  const entries=[user(1,'Add a costume reference'),proposal(2,'first',[layout]),user(3,'ok')];
  assert.equal(proposalState(entries,'first').status,'confirmed');
});

test('C2 reference video context is not a Picture edit and legacy copied pending text clears',async()=>{
  const {proposalState,assertProposalSubmission}=await api();
  const before=proposal(1,'c2-plan',[face,layout]);
  const after=proposal(3,'c3-closeup',[face,layout]);
  after.value.proposal.pending_references=['我那个工作流是把C2加入参考视频'];
  const entries=[before,user(2,'我那个工作流是把C2加入参考视频'),after,user(4,'ok')];
  const state=proposalState(entries,'c3-closeup');
  assert.equal(state.status,'confirmed');
  assert.deepEqual(state.pending,[]);
  assert.deepEqual(state.unverifiable??[],[]);
  assert.doesNotThrow(()=>assertProposalSubmission(entries,[{sha256:face},{sha256:layout}]));
});

const mutations=[
  ['replace must remove old image','把第二张参考图换成新图',[face,layout],[face,layout,alternate],false],
  ['add must preserve old images','加入一张参考图',[face,layout],[face,alternate],false],
  ['remove must actually remove','删除第二张参考图',[face,layout,alternate],[face,layout,alternate],false],
  ['shorthand replace must change','换图',[face,layout],[face,layout],false],
  ['shorthand add must change','加图',[face,layout],[face,layout],false],
  ['shorthand remove must change','删图',[face,layout],[face,layout],false],
  ['shorthand replace works','换图',[face,layout],[face,alternate],true],
  ['shorthand add works','加图',[face,layout],[face,layout,alternate],true],
  ['shorthand remove works','删图',[face,layout,alternate],[face,alternate],true],
  ['numbered replace must target correct image','把第二张参考图换成新图',[face,layout],[alternate,layout],false],
  ['numbered remove must target correct image','删除第二张参考图',[face,layout,alternate],[face,layout],false],
  ['English remove works','Remove reference #2',[face,layout,alternate],[face,alternate],true],
];
for(const [name,request,before,after,allow] of mutations)test(name,async()=>{
  const {proposalState,assertProposalSubmission}=await api();
  const entries=[proposal(1,'before',before),user(2,'ok'),user(3,request),proposal(4,'after',after)];
  assert.equal(proposalState(entries,'before',{seq:1}).status,'superseded');
  assert.throws(()=>assertProposalSubmission(entries,after.map(sha256=>({sha256}))),/pending|confirm/,'old approval must not authorize changed references');
  entries.push(user(5,'ok'));
  assert.equal(proposalState(entries,'after').status,allow?'confirmed':'references_pending');
  if(allow)assert.doesNotThrow(()=>assertProposalSubmission(entries,after.map(sha256=>({sha256}))));
  else assert.throws(()=>assertProposalSubmission(entries,after.map(sha256=>({sha256}))),/pending/);
});

test('production steps and schema descriptions do not become permanent reference mutations',async()=>{
  const {proposalState}=await api();
  const technical=[
    "THIS TURN: generate only the missing landscape Layout for synthetic case Alpha using the selected image workflow",
    'THIS TURN generate one synthetic prop Layout; leave video generation for later',
    'Remove old jacket/room loaders91/90 and old ref sockets; use Picture1 synthetic actor and Picture2 accepted staging image',
    'h3_review references include actual source paths, staged Comfy image names, pixel-grounded observations/responsibilities and connection order; dialogue exact speaker/language/text',
  ];
  const p=proposal(7,'current',[face,layout]);p.value.proposal.pending_references=technical;
  const state=proposalState([proposal(1,'old'),...technical.map((t,i)=>user(i+2,t)),p,user(8,'ok')],'current');
  assert.equal(state.status,'confirmed');assert.deepEqual(state.pending,[]);
});

test('real edits remain pending when the user also mentions technical follow-up',async()=>{
  const {proposalState}=await api();
  for(const text of ['Replace reference #2 with a new image, then update h3_review','Remove reference #2 and its loader','Please include a costume reference']){
    const state=proposalState([proposal(1,'old',[face,layout]),user(2,text),proposal(3,'new',[face,layout]),user(4,'ok')],'new');
    assert.equal(state.status,'references_pending',text);
  }
});

test('pending ref edits stay with their clips instead of blocking unrelated clips',async()=>{
  const {proposalState}=await api();
  const other=proposal(3,'other',[alternate]);other.value.proposal.shots[0].clip_id='c2';
  const entries=[proposal(1,'first'),user(2,'加图'),other,user(4,'ok')];
  assert.equal(proposalState(entries,'other').status,'confirmed');
  entries.push(proposal(5,'return',[face]),user(6,'ok'));
  assert.equal(proposalState(entries,'return').status,'references_pending');
});
test('a reference removed from one clip is verified against that clip, not the card-wide union',async()=>{
  const {proposalState}=await api();
  const multi=(seq,version,secondRefs)=>({seq,kind:'proposal',value:{items:[{type:'image',sha256:face},{type:'image',sha256:layout}],proposal:{version,shots:[
    {clip_id:'opening',reference_numbers:[1,2]},
    {clip_id:'mother_reveal',reference_numbers:secondRefs}
  ]}}});
  for(const instruction of ['Remove Picture 1 from clip 2 only','Remove Picture 1 from C2 only']){
    const before=multi(1,'v1',[1,2]);
    const after=multi(3,'v2',[2]);
    assert.deepEqual(proposalState([before,user(2,instruction),after],'v2').pending,[],instruction);
    assert.deepEqual(proposalState([before,user(2,instruction),multi(3,'v2',[1,2])],'v2').pending,[instruction],instruction);
  }
});

test('changing a workflow for image generation does not demand reference replacement',async()=>{
  const {proposalState}=await api();
  for(const request of ['换工作流来生图','Change the workflow for image generation','Change the image workflow to another model','Update the prompt while keeping the reference images unchanged','把图片生成模型换成另一个','Change image resolution to 1080','修改图片分辨率','Change image node settings','修改图片节点','修改参考图分辨率']){
    const entries=[proposal(1,'v1',[face,layout]),user(2,request),proposal(3,'v2',[face,layout]),user(4,'ok')];
    assert.equal(proposalState(entries,'v2').status,'confirmed',request);
  }
});

// A graph socket rewrite is not an image replacement; suppressing a whole
// sentence instead of just its technical clause would lose real user edits.
test('flat socket rewrite does not create a permanently pending image replacement',async()=>{
  const {proposalState,assertProposalSubmission}=await api();
  for(const text of [
    'Replace stale references with five flat dotted H3 sockets in the same canonical order',
    'Swap the old refs with 5 dotted input sockets',
  ])for(const prior of [[],[proposal(0,'old',[face,layout])]]){
    const p=proposal(2,'new',[face,layout]);
    const entries=[...prior,user(1,text),p,user(3,'approve new')];
    assert.equal(proposalState(entries,'new').status,'confirmed',text);
    assert.deepEqual(proposalState(entries,'new').pending,[]);
    assert.doesNotThrow(()=>assertProposalSubmission(entries,[{sha256:face},{sha256:layout}]));
    assert.throws(()=>assertProposalSubmission(entries,[{sha256:layout},{sha256:face}]),/match/);
  }
});

test('legacy inferred socket labels clear without clearing a genuinely missing image',async()=>{
  const {proposalState}=await api();
  const text='Replace stale references with five flat dotted H3 sockets in the same canonical order';
  const p=proposal(2,'new',[face,layout]);p.value.proposal.pending_references=[text];
  const entries=[user(1,text),p,user(3,'ok')];
  assert.equal(proposalState(entries,'new').status,'confirmed');
  p.value.proposal.pending_references.push('Missing actor Layout');
  assert.deepEqual(proposalState(entries,'new').pending,['Missing actor Layout']);
  assert.equal(proposalState(entries,'new').status,'references_pending');
});

test('socket wording never hides numbered, file or later visual-reference mutations',async()=>{
  const {proposalState,assertProposalSubmission}=await api();
  for(const text of [
    'Replace reference #2 with a new image using flat dotted H3 sockets',
    'Replace references with new-face.png using flat dotted H3 sockets',
    'Replace stale references with five flat dotted H3 sockets and replace reference #2 with a new image',
    'Replace stale references with five flat dotted H3 sockets; remove reference #2',
  ]){
    const p=proposal(3,'new',[face,layout]);p.value.proposal.pending_references=[text];
    const entries=[proposal(1,'old',[face,layout]),user(2,text),p,user(4,'ok')];
    assert.equal(proposalState(entries,'new').status,'references_pending',text);
    assert.throws(()=>assertProposalSubmission(entries,[{sha256:face},{sha256:layout}]),/pending/);
  }
});

// Prose-format nouns must stop operation matching; otherwise a valid H3
// wording instruction creates an impossible image-byte removal obligation.
const proseInstruction="Reuse the sample Subject/Picture provenance and retention structure but remove the sample actor's dialogue/action/ending wording";
test('H3 provenance and wording instructions preserve approved reference bindings',async()=>{
  const {proposalState,assertProposalSubmission}=await api();
  for(const text of [
    `Can you prepare the next shot?\n${proseInstruction}`,
    'Can you update the reference wording for this prompt?',
    'Can you reuse the Picture provenance and remove stale narration wording?',
  ]){
    const entries=[proposal(1,'v1',[face,layout]),user(2,'ok'),user(3,text)];
    assert.equal(proposalState(entries,'v1').status,'confirmed',text);
    assert.deepEqual(proposalState(entries,'v1').pending,[],text);
    assert.doesNotThrow(()=>assertProposalSubmission(entries,[{sha256:face},{sha256:layout}]));
    assert.throws(()=>assertProposalSubmission(entries,[{sha256:layout},{sha256:face}]),/match/);
  }
});

test('prose wording never hides an actual image mutation in the same message',async()=>{
  const {proposalState,assertProposalSubmission}=await api();
  for(const text of [
    `Can you prepare the next shot?\n${proseInstruction}; remove reference #2`,
    `Can you prepare the next shot?\n${proseInstruction} and replace reference #2 with new-face.png`,
    'Can you remove reference #2 and update its wording?',
    'Can you add a new costume image and revise its provenance wording?',
    'Can you update the reference wording for this prompt? Replace reference #2 with new-face.png',
  ]){
    const entries=[proposal(1,'v1',[face,layout]),user(2,'ok'),user(3,text)];
    assert.equal(proposalState(entries,'v1').status,'references_pending',text);
    assert.throws(()=>assertProposalSubmission(entries,[{sha256:face},{sha256:layout}]),/pending/);
  }
});

test('provenance and wording descriptors do not hide explicit image edits',async()=>{
  const {proposalState,assertProposalSubmission}=await api();
  for(const text of [
    'Can you take reference #2 with unknown provenance and remove it?',
    'Can you take reference #2 with unknown provenance and replace it with new-face.png?',
    'Can you remove the provenance-mismatched reference #2?',
    'Can you add a provenance reference image?',
    'Can you take reference #2 with old wording and remove it?',
    'Can you remove the wording-mismatched reference #2?',
    'Can you add a reference provenance image?',
    'Can you add a reference wording image?',
  ]){
    const entries=[proposal(1,'v1',[face,layout]),user(2,'ok'),user(3,text)];
    assert.equal(proposalState(entries,'v1').status,'references_pending',text);
    assert.throws(()=>assertProposalSubmission(entries,[{sha256:face},{sha256:layout}]),/pending/);
  }
});

const noListInstruction='Use that exact passing argument object, no script rebuild, prompt rewrite, card, reference change or new generation mode';
test('conditional preservation of existing references is not a reference edit',async()=>{
  const {proposalState}=await api();
  const instruction='Keep the story, exact dialogue, identity/wardrobe choices, and the nine selected references unless a specific correction requires a change.';
  const entries=[proposal(1,'v1',[face,layout]),user(2,instruction),proposal(3,'v2',[face,layout])];
  assert.deepEqual(proposalState(entries,'v2').pending,[]);
  const oldCard=proposal(3,'v2',[face,layout]);
  oldCard.value.proposal.pending_references=[instruction.replace(/\.$/u,'')];
  assert.deepEqual(proposalState([proposal(1,'v1',[face,layout]),user(2,instruction),oldCard],'v2').pending,[]);
});
test('tool-call retrospection and shot/ref card updates do not request image edits',async()=>{
  const {proposalState}=await api();
  const entries=[proposal(1,'v2',[face,layout]),
    user(2,"The earlier `director_edit_review remove reference_number:1` call was not authorized. Removing the subject's identity image was an incorrect response to the pending-reference warning."),
    user(3,'Now update the shot/ref review card to v3'),
    proposal(4,'v3',[face,layout])];
  assert.deepEqual(proposalState(entries,'v3').pending,[]);
  entries.push(user(5,'Please remove reference #2 from the shot/ref review card'));
  assert.deepEqual(proposalState(entries,'v3').pending,['Please remove reference #2 from the shot/ref review card']);
});
test('nominal no-list reference prohibitions preserve approved bindings',async()=>{
  const {proposalState,assertProposalSubmission}=await api();
  for(const text of [
    `Can you proceed?\n${noListInstruction}`,
    'Can you proceed?\nNo reference change.',
    'Can you proceed?\nNo workflow rebuild, prompt rewrite or image change.',
  ]){
    const entries=[proposal(1,'v1',[face,layout]),user(2,'ok'),user(3,text)];
    assert.equal(proposalState(entries,'v1').status,'confirmed',text);
    assert.deepEqual(proposalState(entries,'v1').pending,[],text);
    assert.doesNotThrow(()=>assertProposalSubmission(entries,[{sha256:face},{sha256:layout}]));
  }
});
test('stopping JSON graph edits is not a request to replace four reference images',async()=>{
  const {proposalState,assertProposalSubmission}=await api();
  const instruction='请停止修改四张图和用 PowerShell 重读 JSON';
  const entries=[proposal(1,'v1',[face,layout]),user(2,instruction),proposal(3,'v2',[face,layout]),user(4,'确认 v2')];
  assert.deepEqual(proposalState(entries,'v2').pending,[]);
  assert.doesNotThrow(()=>assertProposalSubmission(entries,[{sha256:face},{sha256:layout}]));
  entries[2].value.proposal.pending_references=[instruction];
  assert.deepEqual(proposalState(entries,'v2').pending,[],'old inferred blockers must not survive a corrected card');
});
test('a nominal no-list never consumes an actual image-edit directive',async()=>{
  const {proposalState,assertProposalSubmission}=await api();
  for(const text of [
    `Can you proceed?\n${noListInstruction}; replace reference #2 with new-face.png`,
    `Can you proceed?\n${noListInstruction}, remove reference #2`,
    'Can you proceed?\nNo script rebuild, replace reference #2 with new-face.png',
    'Can you proceed?\nNo script rebuild and remove reference #2',
    'Can you proceed?\nNo reference change, but add a costume image',
    'Can you proceed?\nNo script rebuild; reference change is needed',
    'Can you proceed?\nNo script rebuild, reference change is needed',
    'Can you proceed?\nNo script rebuild, reference #2 needs a change',
  ]){
    const entries=[proposal(1,'v1',[face,layout]),user(2,'ok'),user(3,text)];
    assert.equal(proposalState(entries,'v1').status,'references_pending',text);
    assert.throws(()=>assertProposalSubmission(entries,[{sha256:face},{sha256:layout}]),/pending/);
  }
});

test('legacy copied no-list inference is recomputed but declared missing assets remain',async()=>{
  const {proposalState,assertProposalSubmission}=await api();
  const p=proposal(3,'v2',[face,layout]);
  p.value.proposal.pending_references=[noListInstruction];
  const entries=[proposal(1,'v1',[face,layout]),user(2,`Can you proceed?\n${noListInstruction}`),p,user(4,'Approve v2')];
  assert.equal(proposalState(entries,'v2').status,'confirmed');
  assert.doesNotThrow(()=>assertProposalSubmission(entries,[{sha256:face},{sha256:layout}]));
  p.value.proposal.pending_references.push('Missing scene layout');
  assert.deepEqual(proposalState(entries,'v2').pending,['Missing scene layout']);
  assert.throws(()=>assertProposalSubmission(entries,[{sha256:face},{sha256:layout}]),/pending/);
});
