// Harness folds finished tool groups after a result has already been painted.
// Ask its own searchable-hidden disclosures to reveal the completed media once.
// After that, a user can deliberately collapse the group again.
export function keepCompletedMediaVisible(card,{MutationObserver,Event}={}){
  const group=card?.closest('[data-step-process]');
  if(!group)return ()=>{};
  // Native turn disclosures and their process groups are siblings in the
  // conversation flow. Keep capture local to that flow and match the turn id.
  const flow=group.parentElement?.closest('[data-chat-flow]')??group;
  const turn=group.getAttribute('data-chat-turn');
  const View=card.ownerDocument.defaultView;
  const Observer=MutationObserver??View.MutationObserver;
  const MatchEvent=Event??View.Event;
  const requested=new WeakSet();
  let attempted=false,done=false,timer=null;
  const hiddenAncestors=()=>{
    const hidden=[];
    for(let node=card;node;node=node.parentElement){
      if(node.getAttribute('hidden')==='until-found')hidden.push(node);
      if(node===group)break;
    }
    return hidden.reverse();
  };
  const reveal=()=>{
    if(done)return;
    const hidden=hiddenAncestors();
    if(attempted&&!hidden.length){done=true;observer.disconnect();return;}
    for(const element of hidden){
      if(requested.has(element))continue;
      requested.add(element);attempted=true;
      element.dispatchEvent(new MatchEvent('beforematch'));
    }
    if(attempted&&!hiddenAncestors().length){done=true;observer.disconnect();}
  };
  const schedule=()=>{
    if(done||timer!==null)return;
    // Child effects run before Harness parent effects. Defer beforematch until
    // the native searchable-hidden listeners have been attached.
    timer=View.setTimeout(()=>{timer=null;reveal();},0);
  };
  const observer=new Observer(schedule);
  // Capture the native disclosure click before React applies its hidden state.
  // An initially visible completed card may never receive an automatic fold;
  // that must not make its first deliberate user collapse look automatic.
  const manualDisclosure=event=>{
    const control=event.target?.closest?.('button[aria-expanded],summary');
    if(!control||card.contains(control))return;
    const ownTurn=turn!==null&&control.matches('button[data-turn-process]')&&control.getAttribute('data-turn-process')===turn&&control.closest('[data-chat-flow]')===flow;
    if(!group.contains(control)&&!ownTurn)return;
    done=true;View.clearTimeout(timer);observer.disconnect();
  };
  flow.addEventListener('click',manualDisclosure,true);
  observer.observe(group,{subtree:true,attributes:true,attributeFilter:['hidden']});
  schedule();
  return ()=>{done=true;View.clearTimeout(timer);observer.disconnect();flow.removeEventListener('click',manualDisclosure,true);};
}
