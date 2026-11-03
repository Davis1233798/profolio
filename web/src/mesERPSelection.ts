export type IntegrationRow = Record<string, any>;
export function eligibleMESMappings(events:IntegrationRow[], mappings:IntegrationRow[], eventId:string):IntegrationRow[] {
 const event=events.find(row=>row.id===eventId&&row.status==='pending');
 return event ? mappings.filter(row=>Boolean(row.isActive)&&row.mesProductId===event.mesProductId) : [];
}
