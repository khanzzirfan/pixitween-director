// Owned by S10. The submission documents and the headings each must have, in order.
export interface Heading {
  level: number;
  text: string;
}
export interface RequiredDoc {
  path: string;
  headings: Heading[];
}

const h = (level: number, text: string): Heading => ({ level, text });

export const REQUIRED_DOCS: RequiredDoc[] = [
  {
    path: 'README.md',
    headings: [
      h(1, 'PixiTween Director'),
      h(2, 'What it does'),
      h(2, 'Demo'),
      h(2, 'Meta models used'),
      h(2, 'Architecture'),
      h(2, 'Built during the hackathon'),
      h(2, 'Pre-existing dependencies'),
      h(2, 'Run it locally'),
      h(2, 'Cost per film'),
      h(2, 'Limitations'),
      h(2, 'Licenses and credits'),
      h(2, 'Team'),
    ],
  },
  { path: 'docs/new-vs-existing.md', headings: [h(1, 'New vs existing'), h(2, 'Built during the hackathon'), h(2, 'Pre-existing'), h(2, 'Build process'), h(2, 'How to verify')] },
  { path: 'docs/architecture.md', headings: [h(1, 'Architecture'), h(2, 'System overview'), h(2, 'Film lifecycle'), h(2, 'Tools and the composition'), h(2, 'Where Meta models are used')] },
  { path: 'docs/demo-script.md', headings: [h(1, 'Demo script (3:00)'), h(2, 'Beats and timing'), h(2, 'Narration'), h(2, 'Shot list'), h(2, 'On-screen labels'), h(2, 'Recording checklist')] },
  { path: 'docs/submission-answers.md', headings: [h(1, 'Submission answers'), h(2, 'Project description'), h(2, 'Track and theme'), h(2, 'Bonus prizes'), h(2, 'Claim evidence'), h(2, 'Links')] },
  { path: 'docs/x-post.md', headings: [h(1, 'X post and Discord post'), h(2, 'X post'), h(2, 'Discord post'), h(2, 'Posting checklist')] },
  { path: 'docs/s1-evidence.md', headings: [h(1, 'S1 evidence: what we measured on day 1'), h(2, 'What was probed'), h(2, 'Results'), h(2, 'How to reproduce')] },
];
