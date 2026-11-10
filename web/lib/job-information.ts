const sourceLabels = [
  'Source ID',
  'Source revision',
  'Saved in AgentNewsfeed',
  'Source collection',
];
const roleLabels = [
  'Location',
  'Workplace',
  'Employment period',
  'Employment type',
  'Compensation',
];
const workplaceLabels = new Map([
  ['on_site', 'On-site'],
  ['remote', 'Remote'],
  ['hybrid', 'Hybrid'],
]);
const descriptionMarker = 'Source description:';
const agentNoteMarker = 'Imported agent note:';

export type JobFact = { label: string; value: string };
type JobInformation = {
  roleFacts: JobFact[];
  tags: string[];
  description: string;
  requirement?: string;
  agentNote: string[];
  sourceFacts: JobFact[];
};

function paragraphs(text: string) {
  return text.split(/\n\s*\n/);
}

// Rationale is freeform text. Interpret it only when the import envelope is intact.
export function parseJobInformation(rationale: string): JobInformation | null {
  const lines = rationale.trim().split(/\r\n?|\n/);
  if (lines[0] !== 'Imported from AgentNewsfeed') return null;

  const descriptionStart = lines.indexOf(descriptionMarker);
  const noteStart = lines.indexOf(agentNoteMarker);
  if (
    descriptionStart < 2 ||
    noteStart <= descriptionStart ||
    lines[descriptionStart - 1].trim() ||
    lines[noteStart - 1].trim() ||
    lines.lastIndexOf(descriptionMarker) !== descriptionStart ||
    lines.lastIndexOf(agentNoteMarker) !== noteStart
  ) {
    return null;
  }

  const sourceFacts: JobFact[] = [];
  const roleFacts: JobFact[] = [];
  const seenLabels = new Set<string>();
  let tags: string[] = [];
  for (const line of lines.slice(1, descriptionStart)) {
    if (!line.trim()) continue;
    const separator = line.indexOf(':');
    if (separator < 0) return null;
    const label = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!value || seenLabels.has(label)) return null;
    seenLabels.add(label);

    if (sourceLabels.includes(label)) {
      sourceFacts.push({ label, value });
    } else if (roleLabels.includes(label)) {
      roleFacts.push({
        label,
        value: label === 'Workplace' ? (workplaceLabels.get(value) ?? value) : value,
      });
    } else if (label === 'Tags') {
      tags = value.split(',').map((tag) => tag.trim());
      if (tags.some((tag) => !tag)) return null;
    } else {
      return null;
    }
  }

  const sourceDescription = lines
    .slice(descriptionStart + 1, noteStart)
    .join('\n')
    // Remove blank separator lines while retaining indentation in the source text.
    .replace(/^\s*\n|\n\s*$/g, '');
  const note = lines
    .slice(noteStart + 1)
    .join('\n')
    .trim();
  if (sourceFacts.length !== sourceLabels.length || !sourceDescription.trim() || !note) return null;

  const legacySummary = splitLegacyInternshipDescription(sourceDescription);
  return {
    roleFacts,
    tags,
    description: legacySummary?.description ?? sourceDescription,
    requirement: legacySummary?.requirement,
    agentNote: paragraphs(note),
    sourceFacts,
  };
}

const legacyDutiesAndStack =
  /^Build [^\s.:;][^.:;]* using [^\s.:;][^.:;]*; stack includes [^\s.:;][^.:;]*\.$/i;
const legacyEnrollment =
  /^Requires (?:relevant )?(?:bachelor['’]s(?:\/master['’]s)?|master['’]s) enrollment$/i;
const legacyGraduationDeadline =
  /^graduation by (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/i;
const legacyInternshipExperience =
  /^and prior internship experience(?: developing and launching products)?\.$/i;
const legacyVisaStatement =
  /^Employer states it (?:sponsors|does not sponsor) employment visas for this role\.$/i;
const sentenceSegmenter =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('en', { granularity: 'sentence' })
    : undefined;

function splitLegacyInternshipDescription(description: string) {
  if (!sentenceSegmenter || description.includes('\n') || /^\s/.test(description)) return;
  const sentences = Array.from(sentenceSegmenter.segment(description), ({ segment }) => segment);
  // The legacy internship summary has three sentences for technical duties, eligibility and sponsorship.
  if (sentences.length !== 3) return;
  const [opening, eligibility, sponsorship] = sentences;
  if (
    !legacyDutiesAndStack.test(opening.trimEnd()) ||
    !legacyVisaStatement.test(sponsorship.trim())
  ) {
    return;
  }

  const requirement = eligibility.trim();
  const clauses = requirement.split(/,\s+/);
  if (
    clauses.length !== 3 ||
    !legacyEnrollment.test(clauses[0]) ||
    !legacyGraduationDeadline.test(clauses[1]) ||
    !legacyInternshipExperience.test(clauses[2])
  ) {
    return;
  }

  return {
    description: opening + sponsorship,
    requirement,
  };
}
