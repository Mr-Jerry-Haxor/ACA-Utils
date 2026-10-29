import fs from 'node:fs';
import path from 'node:path';

const harPath = path.resolve('research data/scorecard-ui.tas-ewd.apps.boeing.com.har');
if (!fs.existsSync(harPath)) {
  console.log('HAR fixture is absent; contract verification skipped.');
  process.exit(0);
}
const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
const entries = har?.log?.entries ?? [];
const expectations = {
  '/Metric/GetMetricsDataDetails': ['Application','Maintaining_Organization','Application_Manager','System_Criticality_Assessment_Current','System_Criticality_Due_Date'],
  '/Metric/GetMetricsDataRollUps': ['EXTRACTDATE'],
  '/Metric/GetAppRecoveryPlanDetails': ['Application_Name','Plan_Name','Plans_Compliant_Overall','Plans_Complete','Plans_Current','Plans_Tested_And_Validated','Orientation_Date','Table_Top_Date','Drill_Date','Functional_Date'],
  '/Metric/GetAppRecoveryPlanRollUps': ['EXTRACTDATE'],
  '/Metric/GetRiskProfilerDetails': ['Application','Risk_Prolifer_Due_Date','Risk_Prolifer_Current'],
  '/Metric/GetRiskProfilerRollUps': ['EXTRACTDATE'],
  '/Metric/GetAccessControlDetails': ['Application','ACP_Review_Due_Date','ACP_Reviewed'],
  '/Metric/GetAccessControlRollUps': ['EXTRACTDATE'],
  '/Metric/GetNistTypeDetails': ['Asset_Name','Has_CUI','Overall_NIST_Compliance','Nist_Assessment_Completion_Date'],
  '/Metric/GetNistTypeRollUps': ['EXTRACTDATE'],
};

for (const [endpoint, fields] of Object.entries(expectations)) {
  const entry = entries.find((candidate) => {
    try { return candidate.request.method === 'GET' && candidate.response.status === 200 && new URL(candidate.request.url).pathname === endpoint && candidate.response?.content?.text; }
    catch { return false; }
  });
  if (!entry) throw new Error(`Missing successful HAR response for ${endpoint}`);
  const body = JSON.parse(entry.response.content.text);
  if (!Array.isArray(body) || body.length === 0) throw new Error(`${endpoint} must return a non-empty array`);
  const missing = fields.filter((field) => !(field in body[0]));
  if (missing.length) throw new Error(`${endpoint} is missing fields: ${missing.join(', ')}`);
  const url = new URL(entry.request.url);
  if (url.searchParams.get('bemsid') !== '1600103') throw new Error(`${endpoint} does not use the expected BEMS ID`);
}
console.log(`Verified ${Object.keys(expectations).length} HAR endpoint contracts.`);
