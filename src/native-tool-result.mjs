// Harness 0.2 stores a tool's content directly on its message. Older sessions
// wrap the same content in a tool-result block. In both formats, tie the result
// to a recorded native tool call before treating its attachments as evidence.
export function nativeToolContents(event,calls,name){
  if(event?.type!=='tool/result')return [];
  const message=event.data?.message;
  if(!Array.isArray(message?.content))return [];
  if(message.role==='tool' || message.source?.kind==='tool'){
    const callId=message.toolCallId??message.source?.callId;
    return !message.isError && calls.get(callId)?.name===name ? [message.content] : [];
  }
  return message.content.flatMap(block=>
    block.type==='tool-result' && !block.isError && calls.get(block.toolCallId)?.name===name && Array.isArray(block.content)
      ? [block.content] : []);
}
