/**
 * Feature test — the Notice of Application.
 *
 * The same case commenced as an application rather than an action. The
 * consequential behaviour is the suppression: a cause the lawyer approved that
 * cannot be pursued on a paper record must be dropped AND reported, never
 * quietly missing. The matter here carries an approved bad-faith issue for
 * exactly that reason.
 *
 * One live LLM call (~$0.15).
 *
 * Usage: npm run serve -- --port 3799   (separate terminal)
 *        npx tsx scripts/feature-test-notice-of-application.ts
 */

const BASE = process.env.EVAL_BASE_URL ?? 'http://localhost:3799';
let failures=0;
const check=(n:string,ok:boolean,d?:string)=>{console.log(`${ok?'PASS':'FAIL'}  ${n}${!ok&&d?`  [${d}]`:''}`);if(!ok)failures++;};
async function api(m:string,u:string,b?:unknown){const r=await fetch(`${BASE}${u}`,{method:m,headers:b===undefined?{}:{'Content-Type':'application/json'},body:b===undefined?undefined:JSON.stringify(b)});return{status:r.status,json:await r.json().catch(()=>({}))as Record<string,unknown>};}

async function main(){
  const m=await api('POST','/api/matters',{clientName:'Ruth Delacroix',matterTitle:'[VERIFY] Notice of Application',matterDescription:'Application vs action.',matterType:'employment_agreement',jurisdiction:'CA'});
  const mid=(m.json.matterId??m.json.id) as string;
  await api('POST','/api/employment/intake',{matterId:mid,intake:{
    client_first_name:'Ruth',client_last_name:'Delacroix',client_age:58,
    employer_legal_name:'Cartwright Industrial Services Inc.',job_title:'Director of Operations',
    hire_date:'2004-05-17',termination_date:'2026-01-09',was_terminated:true,annual_salary:148000,
    termination_clause_exists:true, humiliating_termination:true, roe_wrong_or_missing:true, bad_faith_details:'Escorted out by security in front of the team, and told colleagues she had been let go for cause.',
  }});
  const a=await api('POST','/api/employment/analyze',{matterId:mid});
  const gates=((a.json.analysis as Record<string,unknown>)?.gates??[]) as Array<{triggered:boolean;issueCodes:string[]}>;
  const approved=gates.filter(g=>g.triggered).flatMap(g=>g.issueCodes);
  await api('POST',`/api/employment/${mid}/issues`,{approved,dismissed:[]});
  check('bad faith is an approved issue', approved.some(c=>/bad_faith|manner/.test(c)), approved.join(','));

  const body={procedureType:'ordinary',claimAmount:320000,lawyerName:'Verify',firmName:'Example Firm LLP',courtLocation:'Toronto'};
  const gen=await api('POST',`/api/employment/${mid}/statement-of-claim`,{...body,proceedingForm:'application'});
  check('application generated', gen.status===200, JSON.stringify(gen.json).slice(0,200));
  const html=String(gen.json.html??'');
  const text=html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
  const flags=(gen.json.lawyerReviewFlags??[]) as string[];

  check('titled a Notice of Application', text.includes('NOTICE OF APPLICATION'));
  check('not titled a Statement of Claim', !text.includes('STATEMENT OF CLAIM'));
  check('parties are Applicant and Respondent', /Applicant/.test(text) && /Respondent/.test(text));
  check('no Plaintiff or Defendant in the heading', !/\bPlaintiff\b/.test(text.slice(0,900)));
  check('relief leads with declarations', /THE APPLICANT MAKES APPLICATION FOR/.test(text));
  check('declares the clause unenforceable', text.includes('termination provision') && text.includes('unenforceable'));
  check('declares wrongful dismissal', /wrongfully dismissed/i.test(text));
  check('asks for judgment for the notice period', /judgment in the amount/i.test(text));
  check('no aggravated, moral or punitive damages', !/aggravated|punitive|moral damages/i.test(text));
  check('bad faith is not pleaded', !/BAD FAITH IN THE MANNER/i.test(text));
  check('and the lawyer is told why', flags.some(f=>/Not pleaded on this application/.test(f) && /commence an action instead/.test(f)),
    flags.filter(f=>/Not pleaded/.test(f)).join(' | ').slice(0,160));
  const nums=[...html.matchAll(/<p[^>]*>(\d+)\.(?:&nbsp;| )/g)].map(x=>Number(x[1]));
  check('grounds numbered from 1', nums.length>5 && nums[0]===1 && nums.every((v,i)=>v===i+1), nums.slice(0,20).join(','));
  check('relief items lettered, not numbered', /\(a\)/.test(text) && !html.includes('{{para_alpha_'));

  console.log(`\n${failures===0?'ALL CHECKS PASSED':`${failures} FAILED`}`);
  process.exit(failures===0?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
