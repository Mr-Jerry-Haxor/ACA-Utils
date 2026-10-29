export const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: 1,
  bemsId: '1600103',
  includedOrganizations: [
    'BCA Business Success',
    'BGS IT Business Partner',
    'Boeing Enterprise Security',
    'Business Operations',
    'Corporate Systems',
    'Customer Relationship Management Systems',
    'Engineering Systems',
    'Enterprise AI and Data',
    'Finance Systems',
    'HR Systems',
    'Infrastructure and Operations',
    'IT BP Space & Missile Sys',
    'IT Global',
    'Manufacturing & Quality Systems',
    'Product Support Systems',
    'Program Management Systems',
    'Quality, Risk and Compliance',
    'Sales, Marketing & Business Development',
    'Strategy and Business Operations',
    'Supply Chain, EHS & FAM Systems'
  ],
  restrictedOrganizations: {
    'Boeing Enterprise Security': [
      'EP Manager', 'EP SERVICE', 'EPScan', 'FMS (AAS)', 'IDAP', 'IDF-SDM', 'IDWS', 'ITCS', 'UATA'
    ]
  },
  managerExceptions: [
    { organization: 'Infrastructure and Operations', manager: 'Atkinson, Martin T' },
    { organization: 'Infrastructure and Operations', manager: 'Etchen, Jamey D' },
    { organization: 'Infrastructure and Operations', manager: 'Bakker, Ryan L' },
    { organization: 'Infrastructure and Operations', manager: 'Barton, Shane M' },
    { organization: 'Infrastructure and Operations', manager: 'Morel, Roland' },
    { organization: 'Infrastructure and Operations', manager: 'Christianson, David B' },
    { organization: 'Infrastructure and Operations', manager: 'George, Rachel A' },
    { organization: 'Infrastructure and Operations', manager: 'Meredith, Steven M' },
    { organization: 'Infrastructure and Operations', manager: 'Pinthaveekiat, Kanjana' },
    { organization: 'Enterprise AI and Data', manager: 'Alamengada Vittal, Chengappa' },
    { organization: 'Enterprise AI and Data', manager: 'Andrews, Ninan C' },
    { organization: 'Enterprise AI and Data', manager: 'Anderson, Stacy' },
    { organization: 'Enterprise AI and Data', manager: 'Cannon, Paul R' },
    { organization: 'Enterprise AI and Data', manager: 'Carpiaux, Molly' },
    { organization: 'Enterprise AI and Data', manager: 'Desai, Raj J' },
    { organization: 'Enterprise AI and Data', manager: 'Dunlevy, Timothy S' },
    { organization: 'Enterprise AI and Data', manager: 'Heigert, Bryan' },
    { organization: 'Enterprise AI and Data', manager: 'Huckaby, Ciarra P' },
    { organization: 'Enterprise AI and Data', manager: 'Keith, Alanna-Jean H' },
    { organization: 'Enterprise AI and Data', manager: 'Kiser, Frederick W' },
    { organization: 'Enterprise AI and Data', manager: 'Sang, Sothary' },
    { organization: 'Enterprise AI and Data', manager: 'Sankarappan, Ram Mohan' },
    { organization: 'Enterprise AI and Data', manager: 'Walton, Matthew J' },
    { organization: 'Enterprise AI and Data', manager: 'Nielson, David A' },
    { organization: 'Strategy and Business Operations', manager: 'Futrell, Denise G' },
    { organization: 'Business Operations', manager: 'Zumwalt, Barbara J' },
    { organization: 'Supply Chain, EHS & FAM Systems', manager: 'Bacon, Brian' },
    { organization: 'Engineering Systems', manager: 'Salgaonkar, Gourish' },
    { organization: 'IT Global', manager: 'Faulkner, Michael E' }
  ],
  asaExceptions: [],
  applicationExceptions: [
    'eGSEP',
    'rGSEP',
    'Spectrolab ERP',
    'Spectrolab Tableau Site',
    'EME',
    'Boeing Connected Program',
    'CostPoint-Millennium',
    'Ease-Millennium',
    'IAM National Office - Spirit',
    'SAP gHRS Spirit'
  ]
});

export function cloneDefaultConfig() {
  return structuredClone(DEFAULT_CONFIG);
}
