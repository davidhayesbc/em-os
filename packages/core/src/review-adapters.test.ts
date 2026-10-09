import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  AdapterPermissionError, CalendarReviewAdapter, InMemoryReviewQueueStore, JiraReviewAdapter,
  type AdapterConfig, type AdapterPage, type CalendarItem, type JiraItem, type ReadPage,
} from "./review-adapters.js";

const baseConfig: AdapterConfig = {
  enabled: true, allowedScopes: ["team-calendar"], windowStart: "2026-10-31T00:00:00Z",
  windowEnd: "2026-11-02T00:00:00Z", maxWindowDays: 7, retentionDays: 30,
};
async function fixture<T>(name: string): Promise<{pages: AdapterPage<T>[]}> {
  return JSON.parse(await readFile(resolve(process.cwd(), `fixtures/connectors/${name}`), "utf8")) as {pages: AdapterPage<T>[]};
}
function paged<T>(pages: readonly AdapterPage<T>[], requests: {pageToken?: string; cursor?: string; scope: string}[]): ReadPage<T> {
  return async request => { requests.push({pageToken: request.pageToken, cursor: request.cursor, scope: request.scope}); return pages[request.pageToken ? 1 : 0]; };
}

test("calendar contract paginates, normalizes DST, prompts on ambiguous identity, and propagates deletes", async () => {
  const data = await fixture<CalendarItem>("calendar-pages.synthetic.json"); const requests: {pageToken?:string;cursor?:string;scope:string}[] = []; const store = new InMemoryReviewQueueStore();
  const result = await new CalendarReviewAdapter(baseConfig, paged(data.pages, requests), store).sync("team-calendar");
  assert.deepEqual(requests, [{pageToken:undefined,cursor:undefined,scope:"team-calendar"},{pageToken:"calendar-page-2",cursor:undefined,scope:"team-calendar"}]);
  assert.equal(result.cursor, "calendar-cursor-2"); assert.equal(result.proposed, 1); assert.equal(result.deleted, 1);
  const proposal = [...store.proposals.values()][0];
  assert.equal(proposal.occurredAt, "2026-11-01T05:30:00.000Z");
  assert.equal(proposal.reviewState, "proposed"); assert.match(proposal.owner?.prompt ?? "", /Confirm which person/);
  assert.equal(proposal.sourceUrl, "https://calendar.example.invalid/event/evt-1"); assert.equal(proposal.sourceLinks.length, 2);
  assert.equal(proposal.retentionUntil, "2026-12-01T07:00:00.000Z");
  assert.equal(store.deletions[0].sourceId, "team-calendar:evt-old");
});

test("Calendar and Jira can be enabled independently and reject non-allowlisted scopes", async () => {
  const store = new InMemoryReviewQueueStore(); let calls = 0;
  const disabled = new CalendarReviewAdapter({...baseConfig,enabled:false}, async()=>{calls++;throw new Error("must not read");}, store);
  assert.deepEqual(await disabled.sync("team-calendar"), {status:"disabled",fetched:0,proposed:0,deleted:0}); assert.equal(calls,0);
  const jira = new JiraReviewAdapter({...baseConfig,allowedScopes:["ENG"]}, async()=>({items:[],observedAt:"2026-11-01T00:00:00Z"}),store);
  await assert.rejects(()=>jira.sync("HR"),/not allowlisted/); assert.equal(calls,0);
});

test("cursor advances only after an atomic full-page commit and resumes incrementally", async () => {
  const data = await fixture<JiraItem>("jira-pages.synthetic.json"); const requests: {pageToken?:string;cursor?:string;scope:string}[]=[]; const store=new InMemoryReviewQueueStore(); store.failNextCommit=true;
  const adapter=new JiraReviewAdapter({...baseConfig,allowedScopes:["ENG"]},paged(data.pages,requests),store);
  await assert.rejects(()=>adapter.sync("ENG"),/synthetic commit failure/);
  await adapter.sync("ENG"); await adapter.sync("ENG");
  assert.equal(requests[1].cursor,undefined); assert.equal(requests[2].cursor,"jira-cursor-9");
});

test("cross-source links and dedup suggestions survive without automatic merge", async () => {
  const calendars=await fixture<CalendarItem>("calendar-pages.synthetic.json"); const jira=await fixture<JiraItem>("jira-pages.synthetic.json"); const store=new InMemoryReviewQueueStore();
  await new CalendarReviewAdapter(baseConfig,paged(calendars.pages,[]),store).sync("team-calendar");
  await new JiraReviewAdapter({...baseConfig,allowedScopes:["ENG"]},paged(jira.pages,[]),store).sync("ENG");
  assert.equal(store.proposals.size,2);
  const jiraProposal=[...store.proposals.values()].find(item=>item.provider==="jira");
  assert.equal(jiraProposal?.reviewState,"proposed"); assert.equal(jiraProposal?.dedupSuggestions.length,1); assert.equal(jiraProposal?.sourceLinks.length,2);
  assert.match(jiraProposal?.owner?.prompt ?? "",/Map source identity/);
});

test("scope escape, permission errors, repeated pages and excessive windows fail closed", async () => {
  const store=new InMemoryReviewQueueStore(); const wrong: CalendarItem={id:"x",calendarId:"private",title:"private",htmlLink:"https://calendar.example.invalid/x",start:"2026-11-01T00:00:00Z",updatedAt:"2026-11-01T00:00:00Z"};
  await assert.rejects(()=>new CalendarReviewAdapter(baseConfig,async()=>({items:[wrong],observedAt:"2026-11-01T00:00:00Z"}),store).sync("team-calendar"),/escaped requested scope/);
  await assert.rejects(()=>new CalendarReviewAdapter(baseConfig,async request=>{throw new AdapterPermissionError("calendar",request.scope);},store).sync("team-calendar"),/permission error/);
  await assert.rejects(()=>new CalendarReviewAdapter({...baseConfig,maxPages:2},async()=>({items:[],observedAt:"2026-11-01T00:00:00Z",nextPageToken:"same"}),store).sync("team-calendar"),/repeated page token/);
  await assert.rejects(()=>new CalendarReviewAdapter({...baseConfig,windowEnd:"2027-01-01T00:00:00Z"},async()=>({items:[],observedAt:"2026-11-01T00:00:00Z"}),store).sync("team-calendar"),/at most 7 days/);
  assert.equal(store.proposals.size,0); assert.equal(await store.getCursor("calendar","team-calendar"),undefined);
});

test("DST duplicate local times require explicit offsets and remain distinct UTC instants", async () => {
  const store=new InMemoryReviewQueueStore();
  const items: CalendarItem[]=[
    {id:"before",calendarId:"team-calendar",title:"Before fallback",htmlLink:"https://calendar.example.invalid/before",start:"2026-11-01T01:30:00-04:00",updatedAt:"2026-11-01T06:00:00Z"},
    {id:"after",calendarId:"team-calendar",title:"After fallback",htmlLink:"https://calendar.example.invalid/after",start:"2026-11-01T01:30:00-05:00",updatedAt:"2026-11-01T07:00:00Z"},
  ];
  await new CalendarReviewAdapter(baseConfig,async()=>({items,observedAt:"2026-11-01T08:00:00Z"}),store).sync("team-calendar");
  assert.deepEqual([...store.proposals.values()].map(x=>x.occurredAt).sort(),["2026-11-01T05:30:00.000Z","2026-11-01T06:30:00.000Z"]);
  await assert.rejects(()=>new CalendarReviewAdapter(baseConfig,async()=>({items:[{...items[0],id:"ambiguous",start:"2026-11-01T01:30:00"}],observedAt:"2026-11-01T08:00:00Z"}),store).sync("team-calendar"),/timezone offset/);
});

test("updates are stable by provider identity and retention removes expired proposals", async () => {
  const store=new InMemoryReviewQueueStore(); let title="Initial";
  const adapter=new JiraReviewAdapter({...baseConfig,allowedScopes:["ENG"],retentionDays:1},async()=>({observedAt:"2026-11-01T07:00:00Z",nextCursor:"c",items:[{id:"1",projectKey:"ENG",key:"ENG-1",summary:title,browseUrl:"https://jira.example.invalid/browse/ENG-1",updatedAt:"2026-11-01T06:00:00Z"}]}),store);
  await adapter.sync("ENG"); title="Updated"; await adapter.sync("ENG");
  assert.equal(store.proposals.size,1); assert.match([...store.proposals.values()][0].title,/Updated/); assert.equal([...store.proposals.values()][0].retentionUntil,"2026-11-02T07:00:00.000Z");
  assert.equal(store.applyRetention("2026-11-02T06:59:59Z"),0); assert.equal(store.proposals.size,1);
  assert.equal(store.applyRetention("2026-11-02T07:00:00Z"),1); assert.equal(store.proposals.size,0); assert.equal(store.deletions[0].reason,"retention_expired");
});
