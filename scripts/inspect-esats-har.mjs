import fs from 'node:fs';

const har = JSON.parse(fs.readFileSync('research data/esats.web.boeing.com.har', 'utf8'));
const wanted = [
  '/gateway/taxonomy/Search/SearchMaintainingOrganization',
  '/gateway/taxonomy/OrganizationConnection/GetRelatedBusinessApplicationsByOrgId',
  '/gateway/asset/search/SearchBusinessApplicationWithFilter',
  '/gateway/asset/BusinessApplicationOrganization/GetOrganizationOfBusinessApplication',
  '/gateway/asset/BusinessApplicationLifecycle/GetDeploymentLifecycle',
  '/gateway/asset/BusinessApplicationSummary/GetContactDetailsSummary',
];

for (const path of wanted) {
  const matches = (har.log?.entries ?? []).filter((entry) => {
    try { return new URL(entry.request.url).pathname === path; } catch { return false; }
  });
  const entry = matches.find((item) => item.response?.status === 200 && item.response?.content?.text) ?? matches[0];
  if (!entry) {
    console.log(JSON.stringify({ path, found: false }));
    continue;
  }
  const requestUrl = new URL(entry.request.url);
  const postText = entry.request.postData?.text ?? '';
  let requestBody = null;
  let responseBody = null;
  try { requestBody = postText ? JSON.parse(postText) : null; } catch { requestBody = postText ? '[non-JSON body]' : null; }
  try { responseBody = JSON.parse(entry.response.content.text); } catch { responseBody = '[non-JSON response]'; }
  const first = Array.isArray(responseBody) ? responseBody[0]
    : Array.isArray(responseBody?.data) ? responseBody.data[0]
      : responseBody?.data && typeof responseBody.data === 'object' ? responseBody.data
        : responseBody;
  const nestedKeys = {};
  if (path.endsWith('/GetContactDetailsSummary') && Array.isArray(responseBody)) {
    nestedKeys.roleTypes = [...new Set(responseBody.map((item) => item.roleType).filter(Boolean))];
    nestedKeys.userKeys = [...new Set(responseBody.flatMap((item) => item.user && typeof item.user === 'object' ? Object.keys(item.user) : []))];
    nestedKeys.usersItemKeys = [...new Set(responseBody.flatMap((item) => Array.isArray(item.users) ? item.users.flatMap((user) => Object.keys(user ?? {})) : []))];
  }
  if (path.endsWith('/GetDeploymentLifecycle') && responseBody && typeof responseBody === 'object') {
    nestedKeys.lifecycleTransitionKeys = [...new Set((responseBody.lifecycleTransitions ?? []).flatMap((item) => Object.keys(item ?? {})))];
    nestedKeys.deploymentPhaseKeys = responseBody.deploymentLifecyclePhaseType && typeof responseBody.deploymentLifecyclePhaseType === 'object' ? Object.keys(responseBody.deploymentLifecyclePhaseType) : [];
  }
  if (path.endsWith('/GetDeploymentLifecycle')) {
    const bodies = matches.flatMap((item) => {
      try { return [JSON.parse(item.response?.content?.text ?? '')]; } catch { return []; }
    });
    const transition = bodies.flatMap((body) => body?.lifecycleTransitions ?? []).find(Boolean);
    nestedKeys.lifecycleTransitionSample = transition ?? null;
    nestedKeys.dateExamples = bodies.map((body) => ({
      targetRetirementDate: body?.targetRetirementDate,
      retiredStartDate: body?.retiredStartDate,
      deploymentPhase: body?.deploymentPhaseTypeName ?? body?.deploymentPhaseTypeDisplayName,
    })).filter((item) => item.targetRetirementDate || item.retiredStartDate || item.deploymentPhase);
  }
  if (path.endsWith('/SearchBusinessApplicationWithFilter')) {
    const markedEntry = matches.find((item) => item.request.postData?.text?.includes('"markedForDeletionOnly":true'));
    if (markedEntry) {
      try {
        const marked = JSON.parse(markedEntry.response.content.text);
        nestedKeys.markedCount = marked.length;
        nestedKeys.markedDateExamples = marked.slice(0, 5).map((item) => ({ softDeletedOn: item.softDeletedOn, hardDeletedOn: item.hardDeletedOn, phase: item.deploymentLifecyclePhaseType, status: item.status }));
      } catch {}
    }
  }
  if (path.endsWith('/GetRelatedBusinessApplicationsByOrgId') && first) {
    nestedKeys.relatedApplicationShape = {
      esatsIdType: typeof first.businessApplicationEsatsId,
      phase: first.deploymentLifecyclePhaseType,
      maintainingOrganization: first.maintainingOrganization,
      softDeletedType: typeof first.isSoftDeleted,
      softDeletedExample: first.isSoftDeleted,
    };
  }
  console.log(JSON.stringify({
    path,
    occurrences: matches.length,
    method: entry.request.method,
    status: entry.response.status,
    queryKeys: [...requestUrl.searchParams.keys()],
    requestBody,
    responseType: Array.isArray(responseBody) ? 'array' : typeof responseBody,
    responseKeys: responseBody && !Array.isArray(responseBody) && typeof responseBody === 'object' ? Object.keys(responseBody) : [],
    dataLength: Array.isArray(responseBody) ? responseBody.length : Array.isArray(responseBody?.data) ? responseBody.data.length : null,
    sampleKeys: first && typeof first === 'object' && !Array.isArray(first) ? Object.keys(first) : [],
    requestHeaderNames: (entry.request.headers ?? []).map((header) => header.name.toLowerCase()).filter((name, index, names) => names.indexOf(name) === index),
    nestedKeys,
  }, null, 2));
}
