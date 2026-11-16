// Workplace English assessment content, written for LoyalHire (v1, November 2026).
// Two levels: A2 (basic workplace English) and B1 (independent workplace English).
// These are internal screening tests. They are not a formal CEFR certificate and have not been psychometrically validated.
// Answer keys live only in this file and never leave the server.

export interface ObjectiveItem { id: string; section: 'reading' | 'language'; prompt: string; options: string[]; answer: number }
export interface AssessmentTemplate {
  level: 'A2' | 'B1'; version: number; title: string; minutes: number;
  passageTitle: string; passage: string[]; items: ObjectiveItem[];
  writingPrompt: string; writingWords: [number, number];
}

export const RUBRIC: { key: string; label: string; help: string }[] = [
  { key: 'task', label: 'Task completed', help: 'Did they do everything the question asked?' },
  { key: 'organisation', label: 'Clear and organised', help: 'Is it easy to follow, in a sensible order?' },
  { key: 'grammar', label: 'Grammar', help: 'Are the sentences correct enough to be understood without effort?' },
  { key: 'vocabulary', label: 'Vocabulary', help: 'Do they have the words for the job, used correctly?' },
  { key: 'tone', label: 'Workplace tone', help: 'Polite and suitable for a customer or a manager?' }
];
export const RUBRIC_MAX = 4;

const A2: AssessmentTemplate = {
  level: 'A2', version: 1, title: 'Workplace English — Level A2', minutes: 25,
  passageTitle: 'Read this notice from a store manager',
  passage: [
    'To: All store staff',
    'From: Meena, Store Manager',
    'Subject: Stock count on Saturday',
    'Dear team,',
    'We will count all the stock in the store this Saturday. Please come at 8:00 in the morning, one hour before the store opens. Ravi will count the gold items and Sana will count the silver items. Everyone else will help at the counters.',
    'Please do not take leave on Saturday. Breakfast will be given at 7:45 in the staff room. The count must finish before 11:00 because a customer is coming to collect a large order at 11:30.',
    'If you have any questions, call me before Friday evening.',
    'Thank you,',
    'Meena'
  ],
  items: [
    { id: 'r1', section: 'reading', prompt: 'On which day is the stock count?', options: ['Friday', 'Saturday', 'Sunday', 'Monday'], answer: 1 },
    { id: 'r2', section: 'reading', prompt: 'What time does the store usually open?', options: ['7:45', '8:00', '9:00', '11:00'], answer: 2 },
    { id: 'r3', section: 'reading', prompt: 'Who will count the silver items?', options: ['Ravi', 'Meena', 'Sana', 'Everyone'], answer: 2 },
    { id: 'r4', section: 'reading', prompt: 'Why must the count finish before 11:00?', options: ['The store closes at 11:00', 'Breakfast is at 11:00', 'A customer is coming to collect an order', 'Meena is going on leave'], answer: 2 },
    { id: 'r5', section: 'reading', prompt: 'What should staff do if they have a question?', options: ['Write a letter to the customer', 'Call Meena before Friday evening', 'Ask Ravi on Saturday', 'Wait until the count is finished'], answer: 1 },
    { id: 'l1', section: 'language', prompt: 'I ___ at this company for two years.', options: ['work', 'am work', 'have worked', 'working'], answer: 2 },
    { id: 'l2', section: 'language', prompt: 'Could you ___ me the invoice, please?', options: ['send', 'sends', 'sending', 'sent'], answer: 0 },
    { id: 'l3', section: 'language', prompt: 'The meeting is ___ Monday at 10 o’clock.', options: ['in', 'on', 'at', 'to'], answer: 1 },
    { id: 'l4', section: 'language', prompt: 'She ___ to the customer yesterday.', options: ['speak', 'speaks', 'spoke', 'speaking'], answer: 2 },
    { id: 'l5', section: 'language', prompt: 'There aren’t ___ boxes in the store room.', options: ['some', 'any', 'a', 'much'], answer: 1 },
    { id: 'l6', section: 'language', prompt: 'This printer is ___ than the old one.', options: ['fast', 'more fast', 'faster', 'fastest'], answer: 2 },
    { id: 'l7', section: 'language', prompt: 'A customer says, “Thank you for your help.” What is the best reply?', options: ['You’re welcome.', 'Yes, I am.', 'I thank.', 'It is help.'], answer: 0 },
    { id: 'l8', section: 'language', prompt: 'Please ___ the form and sign at the bottom.', options: ['fill in', 'fill on', 'full', 'fill at'], answer: 0 },
    { id: 'l9', section: 'language', prompt: 'I’m sorry, Mr Shah is not here. Can I take a ___?', options: ['letter', 'message', 'talk', 'phone'], answer: 1 },
    { id: 'l10', section: 'language', prompt: 'We ___ deliver the order tomorrow because the truck is not available.', options: ['can', 'can’t', 'must', 'do'], answer: 1 }
  ],
  writingPrompt: 'Your manager has asked you to work this Sunday, but you have a family function. Write a short email to your manager. Say that you cannot come, give the reason, and offer to work on another day.',
  writingWords: [50, 70]
};

const B1: AssessmentTemplate = {
  level: 'B1', version: 1, title: 'Workplace English — Level B1', minutes: 25,
  passageTitle: 'Read this email from an operations manager',
  passage: [
    'Subject: Changes to how we handle delivery complaints',
    'Dear colleagues,',
    'Over the last three months, complaints about late deliveries have risen by almost a third. When we looked at the cases, we found that most delays were not caused by the courier. In fact, more than half happened because orders were confirmed before we had checked whether the items were in stock.',
    'From Monday, therefore, no order should be confirmed to a customer until the warehouse has replied to the stock request. This may add a few hours to our response time, but it should prevent promises we cannot keep.',
    'If a customer complains about a delay, apologise first, then give a realistic new date rather than an optimistic one. Do not offer a discount unless your team lead has agreed to it.',
    'Finally, please record every complaint in the system on the same day, even if it has already been solved, so that we can see whether the new process is working.',
    'Regards,',
    'Anita Rao, Operations'
  ],
  items: [
    { id: 'r1', section: 'reading', prompt: 'What is the main purpose of this email?', options: ['To announce a new courier company', 'To explain a new process that should reduce late-delivery complaints', 'To offer discounts to unhappy customers', 'To thank the warehouse team'], answer: 1 },
    { id: 'r2', section: 'reading', prompt: 'According to the email, what caused most of the delays?', options: ['The courier was slow', 'Customers changed their orders', 'Orders were confirmed before stock was checked', 'The system was not working'], answer: 2 },
    { id: 'r3', section: 'reading', prompt: 'From Monday, what must happen before an order is confirmed?', options: ['The team lead must agree', 'The customer must pay in full', 'The courier must be booked', 'The warehouse must reply to the stock request'], answer: 3 },
    { id: 'r4', section: 'reading', prompt: 'When a customer complains about a delay, what should staff do first?', options: ['Apologise', 'Offer a discount', 'Give the earliest possible date', 'Call the courier'], answer: 0 },
    { id: 'r5', section: 'reading', prompt: 'Why should complaints be recorded even when they are already solved?', options: ['To calculate discounts', 'To see whether the new process is working', 'To report the courier', 'To reduce response time'], answer: 1 },
    { id: 'l1', section: 'language', prompt: 'If the shipment ___ tomorrow, we will inform the customer immediately.', options: ['arrives', 'will arrive', 'arrived', 'would arrive'], answer: 0 },
    { id: 'l2', section: 'language', prompt: 'The report ___ by the finance team before it is sent to the client.', options: ['checks', 'is checked', 'is checking', 'has checked'], answer: 1 },
    { id: 'l3', section: 'language', prompt: 'I look forward to ___ from you.', options: ['hear', 'hearing', 'heard', 'be hearing'], answer: 1 },
    { id: 'l4', section: 'language', prompt: 'She has been working on this project ___ March.', options: ['for', 'since', 'from', 'during'], answer: 1 },
    { id: 'l5', section: 'language', prompt: 'Could you tell me when ___?', options: ['does the meeting start', 'the meeting starts', 'starts the meeting', 'is the meeting start'], answer: 1 },
    { id: 'l6', section: 'language', prompt: 'We had to ___ the launch because the software was not ready.', options: ['put off', 'put on', 'put up', 'put out'], answer: 0 },
    { id: 'l7', section: 'language', prompt: '___ the price was higher, the customer chose our product.', options: ['Because', 'Although', 'Despite', 'However'], answer: 1 },
    { id: 'l8', section: 'language', prompt: 'Which is the most polite way to ask a colleague for a file?', options: ['Send me the file now.', 'I want the file.', 'Would you mind sending me the file when you have a moment?', 'You must send me the file.'], answer: 2 },
    { id: 'l9', section: 'language', prompt: 'The manager suggested ___ the meeting to Friday.', options: ['to move', 'moving', 'move', 'moved'], answer: 1 },
    { id: 'l10', section: 'language', prompt: 'I’m afraid there has been a ___ with your order; two items are missing.', options: ['mistake', 'fault', 'wrong', 'damage'], answer: 0 }
  ],
  writingPrompt: 'A customer has written to say that their order arrived five days late and one item was missing. Write a reply to the customer. Apologise, explain briefly what happened, say what you will do to put it right, and tell them when they can expect the missing item.',
  writingWords: [100, 130]
};

export const TEMPLATES: Record<string, AssessmentTemplate> = { A2, B1 };
export const LEVELS = ['A2', 'B1'] as const;
export type Level = typeof LEVELS[number];

/** What the candidate's page is allowed to see: the questions without the answer keys. */
export function publicTemplate(level: string): { level: string; title: string; minutes: number; passageTitle: string; passage: string[]; items: { id: string; section: string; prompt: string; options: string[] }[]; writingPrompt: string; writingWords: [number, number] } {
  const t = TEMPLATES[level];
  return { level: t.level, title: t.title, minutes: t.minutes, passageTitle: t.passageTitle, passage: t.passage, items: t.items.map((i) => ({ id: i.id, section: i.section, prompt: i.prompt, options: i.options })), writingPrompt: t.writingPrompt, writingWords: t.writingWords };
}

export function scoreObjective(level: string, answers: Record<string, unknown>): { score: number; total: number; reading: number; readingTotal: number; language: number; languageTotal: number } {
  const t = TEMPLATES[level];
  let reading = 0, language = 0;
  for (const i of t.items) {
    const given = answers[i.id];
    if (typeof given === 'number' && given === i.answer) { if (i.section === 'reading') reading++; else language++; }
  }
  const readingTotal = t.items.filter((i) => i.section === 'reading').length;
  return { score: reading + language, total: t.items.length, reading, readingTotal, language, languageTotal: t.items.length - readingTotal };
}
