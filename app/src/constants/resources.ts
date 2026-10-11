// The resources page for the region the app serves. Only New York City for now.
// Point to reporting, drop-off and supplies; never give step-by-step sharps or biohazard handling instructions.

export interface ResourceLink {
  label: string;
  url: string;
}

export interface Resource {
  title: string;
  body: string;
  links: ResourceLink[];
}

export const RESOURCES: Resource[] = [
  {
    title: 'Needles or biological waste',
    body: 'The recommended approach is to call 311. On public streets, sidewalks and parks, the city collects them, usually within a few days. On private property, the owner is responsible. If you choose to handle them yourself, be extremely careful.',
    links: [
      { label: 'Call 311', url: 'tel:311' },
      { label: 'Report online', url: 'https://portal.311.nyc.gov/' },
    ],
  },
  {
    title: 'Drop off sharps',
    body: 'Every New York State hospital and nursing home accepts household sharps for free, with no ID needed. Call ahead. Sharps must be sealed in a rigid, puncture-proof container labeled "HOME SHARPS - NOT FOR RECYCLING". Each sharps quest lists the nearest drop-off sites.',
    links: [
      {
        label: 'NYC sharps disposal',
        url: 'https://nyc.gov/site/dsny/collection/get-rid-of/pharmaceutical-sharps-drop-off.page',
      },
    ],
  },
  {
    title: 'If you are stuck by a needle',
    body: 'Wash the area with soap and water and get medical care right away.',
    links: [{ label: 'Call 911', url: 'tel:911' }],
  },
  {
    title: 'Chemicals, paint, batteries and electronics',
    body: 'Do not put them in the trash. DSNY special waste drop-off sites in all five boroughs take them from NYC residents, Thursday to Saturday, 9am to 5pm.',
    links: [
      {
        label: 'Special waste drop-off',
        url: 'https://www.nyc.gov/site/dsny/what-we-do/programs/special-waste-drop-off.page',
      },
      { label: 'SAFE disposal events', url: 'https://nyc.gov/SafeEvents' },
    ],
  },
  {
    title: 'Dumped furniture and large items',
    body: 'Report illegal dumping on public property to 311, and do not move anything you cannot lift safely.',
    links: [{ label: 'Report online', url: 'https://portal.311.nyc.gov/' }],
  },
  {
    title: 'Cleanup supplies',
    body: "DSNY's Volunteer Cleanup Program lends brooms, shovels and rakes, and gives out bags and gloves, for cleanups on public streets and sidewalks. Apply at least two weeks ahead.",
    links: [
      {
        label: 'Volunteer Cleanup Program',
        url: 'https://www.nyc.gov/site/dsny/resources/education/volunteer-cleanup.page',
      },
    ],
  },
];
