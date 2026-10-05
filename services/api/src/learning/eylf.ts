/**
 * Early Years Learning Framework V2.0 (2022) learning outcomes, as codes the
 * learning records store. Labels are short forms of the framework's wording.
 * MTOP V2.0 (school age) shares the same five outcomes and numbering.
 */
export interface EylfOutcome {
  code: string;
  outcome: number;
  outcomeTitle: string;
  label: string;
}

const OUTCOME_TITLES: Record<number, string> = {
  1: 'Children have a strong sense of identity',
  2: 'Children are connected with and contribute to their world',
  3: 'Children have a strong sense of wellbeing',
  4: 'Children are confident and involved learners',
  5: 'Children are effective communicators',
};

const SUB_OUTCOMES: [string, string][] = [
  ['1.1', 'Feel safe, secure and supported'],
  ['1.2', 'Develop their emerging autonomy, inter-dependence, resilience and agency'],
  ['1.3', 'Develop knowledgeable, confident self-identities and a positive sense of self-worth'],
  ['1.4', 'Learn to interact in relation to others with care, empathy and respect'],
  ['2.1', 'Develop a sense of connectedness to groups and communities, and their rights and responsibilities as active citizens'],
  ['2.2', 'Respond to diversity with respect'],
  ['2.3', 'Become aware of fairness'],
  ['2.4', 'Become socially responsible and show respect for the environment'],
  ['3.1', 'Become strong in their social, emotional and mental wellbeing'],
  ['3.2', 'Take increasing responsibility for their own health and physical wellbeing'],
  ['4.1', 'Develop a growing enjoyment of learning, curiosity, cooperation, confidence, creativity and persistence'],
  ['4.2', 'Develop a range of learning and thinking skills such as problem solving, inquiry, experimentation and investigating'],
  ['4.3', 'Transfer and adapt what they have learned from one context to another'],
  ['4.4', 'Resource their own learning through connecting with people, place, technologies and materials'],
  ['5.1', 'Interact verbally and non-verbally with others for a range of purposes'],
  ['5.2', 'Engage with a range of texts and gain meaning from these texts'],
  ['5.3', 'Express ideas and make meaning using a range of media'],
  ['5.4', 'Begin to understand how symbols and pattern systems work'],
  ['5.5', 'Use digital technologies and media to access information, investigate ideas and represent their thinking'],
];

export const EYLF_OUTCOMES: EylfOutcome[] = SUB_OUTCOMES.map(([code, label]) => {
  const outcome = Number(code.split('.')[0]);
  return { code, outcome, outcomeTitle: OUTCOME_TITLES[outcome], label };
});

const BY_CODE = new Map(EYLF_OUTCOMES.map((o) => [o.code, o]));

export function isEylfCode(code: string): boolean {
  return BY_CODE.has(code);
}

export function eylfOutcome(code: string): EylfOutcome | undefined {
  return BY_CODE.get(code);
}
