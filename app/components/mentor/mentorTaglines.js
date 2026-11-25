// The line that greets people on a new SEO Mentor chat. One is picked at random
// each visit (and each time "New chat" is pressed). The first six are the
// original rotating titles from the earlier chat page.

const taglines = [
  'What SEO mess are we cleaning up today?',
  'SEO is hard. Talking to me isn’t.',
  'Rankings low? Confidence lower? I got you.',
  'Google’s confusing. I’m not.',
  'Your AI sidekick for all things SEO.',
  'Let’s fix what Google isn’t loving yet.',
  'Page two of Google called. Let’s not answer.',
  'Ask me anything. I’ll try not to say “it depends.”',
  'No jargon was harmed in the making of this chat.',
  'Let’s get Google to notice you. Politely.',
  'Keywords, clicks, confusion. Pick one and let’s talk.',
  'Think of me as SEO, minus the homework.',
  'Your website has questions. I have plain-English answers.',
  'I speak fluent Google, so you don’t have to.',
  'Less guessing. More getting found.',
  'What’s Google ignoring today? Let’s look.',
  'Bring me your weirdest SEO question.',
  'I read Google’s guidelines so you can skip them.',
  'Meta titles won’t write themselves. Well, actually…',
  'SEO, explained like you have a business to run.',
  'The algorithm changed again. I’m still here.',
  'Let’s turn “nobody clicked” into “somebody did.”',
  'One small fix at a time. Where do we start?',
  'Nobody’s looking at page two. Let’s aim higher.',
];

// Used about one visit in four, and only when we know the person's first name.
const namedTaglines = [
  'Hey {name}, what are we fixing today?',
  '{name}, Google and I need to talk about your website.',
  'Welcome back, {name}. The algorithm missed you.',
  'Good to see you, {name}. Let’s go bother Google.',
  'Alright {name}, what has Google done this time?',
  '{name}, bring me your SEO questions. Even the weird ones.',
];

/** A usable first name from a display name, or '' (an email or a blank is never used). */
export function firstNameFrom(displayName) {
  const first = typeof displayName === 'string' ? displayName.trim().split(/\s+/)[0] : '';
  return /^\p{L}[\p{L}'’-]{1,19}$/u.test(first) ? first : '';
}

/** Picks a tagline at random, avoiding the one just shown. */
export function pickTagline(firstName = '', previous = '') {
  const pool = firstName && Math.random() < 0.25 ? namedTaglines.map(line => line.replace('{name}', firstName)) : taglines;
  const options = pool.filter(line => line !== previous);
  return options[Math.floor(Math.random() * options.length)];
}

export const mentorTaglineCount = taglines.length + namedTaglines.length;
