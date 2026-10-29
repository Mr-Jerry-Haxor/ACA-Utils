export const DEFAULT_CONFIG_EFFECTIVE_DATE = '2026-10-01';
export const DEFAULT_CONFIG_DATE_LABEL = '1 OCT 26';

export const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: 1,
  bemsId: '1600103',
  includedOrganizations: [
    'BCA Business Success',
    'BGS IT Business Partner',
    'Boeing Enterprise Security',
    'Corporate Systems',
    'Customer Relationship Management Systems',
    'Engineering Systems',
    'Enterprise AI and Data',
    'Finance Systems',
    'HR Systems',
    'IDT&S Business Operations',
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
      'EP Manager',
      'EP SERVICE',
      'EPScan',
      'FMS (AAS)',
      'IDAP',
      'IDWS',
      'UATA'
    ]
  },
  managerExceptions: [
    'Atkinson, Martin T',
    'Etchen, Jamey D',
    'Bakker, Ryan L',
    'Barton, Shane M',
    'Morel, Roland',
    'Christianson, David B',
    'George, Rachel A',
    'Meredith, Steven M',
    'Pinthaveekiat, Kanjana',
    'Alamengada Vittal, Chengappa',
    'Andrews, Ninan C',
    'Anderson, Stacy',
    'Cannon, Paul R',
    'Carpiaux, Molly',
    'Desai, Raj J',
    'Dunlevy, Timothy S',
    'Heigert, Bryan',
    'Huckaby, Ciarra P',
    'Keith, Alanna-Jean H',
    'Kiser, Frederick W',
    'Sang, Sothary',
    'Sankarappan, Ram Mohan',
    'Walton, Matthew J',
    'Nielson, David A',
    'Futrell, Denise G',
    'Zumwalt, Barbara J',
    'Bacon, Brian',
    'Salgaonkar, Gourish',
    'Faulkner, Michael E'
  ],
  asaExceptions: [
    'Croghan, Adam (1670236)',
    'Gardner, Nathaniel (2734353)',
    'Mitchell, Laura A (486708)',
    'Neidlinger, Phillip J (3031782)',
    'Schultz, Jared C (3083132)'
  ],
  excludeBlankAsaFromScmp: false,
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
