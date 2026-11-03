export function trafficCompletion(total:number, completed:number, stopRequested:boolean) {
 const unsent=Math.max(0,total-completed);
 return {stopped:stopRequested&&unsent>0,unsent};
}
