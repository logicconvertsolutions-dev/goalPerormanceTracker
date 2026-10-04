// The My Day "Today's thought" card (P30). A fixed, curated list -- no table,
// no external API. One quote per agent-local calendar day: everyone sees the
// same one all day, and it changes at their own midnight.

export interface Quote {
  text: string;
  author: string;
}

export const QUOTES: readonly Quote[] = [
  { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  { text: 'It always seems impossible until it’s done.', author: 'Nelson Mandela' },
  { text: 'Well done is better than well said.', author: 'Benjamin Franklin' },
  { text: 'Quality is not an act, it is a habit.', author: 'Aristotle' },
  { text: 'The way to get started is to quit talking and begin doing.', author: 'Walt Disney' },
  { text: 'Whether you think you can, or you think you can’t — you’re right.', author: 'Henry Ford' },
  { text: 'Nothing will work unless you do.', author: 'Maya Angelou' },
  { text: 'Opportunities don’t happen. You create them.', author: 'Chris Grosser' },
  { text: 'You miss 100% of the shots you don’t take.', author: 'Wayne Gretzky' },
  { text: 'Act as if what you do makes a difference. It does.', author: 'William James' },
  { text: 'Success is the sum of small efforts, repeated day in and day out.', author: 'Robert Collier' },
  { text: 'Don’t watch the clock; do what it does. Keep going.', author: 'Sam Levenson' },
  { text: 'The harder I work, the luckier I get.', author: 'Samuel Goldwyn' },
  { text: 'Great things are done by a series of small things brought together.', author: 'Vincent van Gogh' },
  { text: 'Energy and persistence conquer all things.', author: 'Benjamin Franklin' },
  { text: 'Do what you can, with what you have, where you are.', author: 'Theodore Roosevelt' },
  { text: 'Believe you can and you’re halfway there.', author: 'Theodore Roosevelt' },
  { text: 'The best time to plant a tree was 20 years ago. The second best time is now.', author: 'Proverb' },
  { text: 'A goal without a plan is just a wish.', author: 'Antoine de Saint-Exupéry' },
  { text: 'Small deeds done are better than great deeds planned.', author: 'Peter Marshall' },
  { text: 'Either you run the day, or the day runs you.', author: 'Jim Rohn' },
  { text: 'Discipline is the bridge between goals and accomplishment.', author: 'Jim Rohn' },
  { text: 'Motivation is what gets you started. Habit is what keeps you going.', author: 'Jim Ryun' },
  { text: 'Every accomplishment starts with the decision to try.', author: 'John F. Kennedy' },
  { text: 'People don’t care how much you know until they know how much you care.', author: 'Theodore Roosevelt' },
  { text: 'Setting goals is the first step in turning the invisible into the visible.', author: 'Tony Robbins' },
  { text: 'If you are not willing to risk the usual, you will have to settle for the ordinary.', author: 'Jim Rohn' },
  { text: 'Success usually comes to those who are too busy to be looking for it.', author: 'Henry David Thoreau' },
  { text: 'The only place where success comes before work is in the dictionary.', author: 'Vidal Sassoon' },
  { text: 'Fall seven times, stand up eight.', author: 'Japanese proverb' },
  { text: 'Start where you are. Use what you have. Do what you can.', author: 'Arthur Ashe' },
  { text: 'It does not matter how slowly you go as long as you do not stop.', author: 'Confucius' },
  { text: 'Perseverance is not a long race; it is many short races one after the other.', author: 'Walter Elliot' },
  { text: 'You don’t have to be great to start, but you have to start to be great.', author: 'Zig Ziglar' },
  { text: 'Your attitude, not your aptitude, will determine your altitude.', author: 'Zig Ziglar' },
  { text: 'Every sale has five obstacles: no need, no money, no hurry, no desire, no trust.', author: 'Zig Ziglar' },
  { text: 'Make each day your masterpiece.', author: 'John Wooden' },
  { text: 'Don’t let what you cannot do interfere with what you can do.', author: 'John Wooden' },
  { text: 'Plans are nothing; planning is everything.', author: 'Dwight D. Eisenhower' },
  { text: 'What we fear doing most is usually what we most need to do.', author: 'Tim Ferriss' },
  { text: 'The expert in anything was once a beginner.', author: 'Helen Hayes' },
  { text: 'Try not to become a person of success, but rather a person of value.', author: 'Albert Einstein' },
  { text: 'The future depends on what you do today.', author: 'Mahatma Gandhi' },
  { text: 'Courage is resistance to fear, mastery of fear — not absence of fear.', author: 'Mark Twain' },
  { text: 'Keep your face always toward the sunshine, and shadows will fall behind you.', author: 'Walt Whitman' },
  { text: 'Luck is what happens when preparation meets opportunity.', author: 'Seneca' },
  { text: 'We are what we repeatedly do.', author: 'Will Durant' },
  { text: 'Action is the foundational key to all success.', author: 'Pablo Picasso' },
  { text: 'Don’t be afraid to give up the good to go for the great.', author: 'John D. Rockefeller' },
  { text: 'The man who moves a mountain begins by carrying away small stones.', author: 'Confucius' },
  { text: 'Focus on being productive instead of busy.', author: 'Tim Ferriss' },
  { text: 'Hard work beats talent when talent doesn’t work hard.', author: 'Tim Notke' },
  { text: 'Success is walking from failure to failure with no loss of enthusiasm.', author: 'Winston Churchill' },
  { text: 'The best way to predict the future is to create it.', author: 'Peter Drucker' },
  { text: 'Knowing is not enough; we must apply. Willing is not enough; we must do.', author: 'Johann Wolfgang von Goethe' },
  { text: 'Progress, not perfection.', author: 'Proverb' },
  { text: 'One call can change a family’s future. Make it.', author: 'Kautis' },
  { text: 'Small steps every day add up to big results.', author: 'Kautis' },
  { text: 'Show up, follow up, and never give up.', author: 'Kautis' },
];

/** Days since 1970-01-01 for a YYYY-MM-DD string -- a stable day index. */
function dayIndex(iso: string): number {
  return Math.floor(new Date(iso + 'T00:00:00Z').getTime() / 86_400_000);
}

/** The quote for a given local calendar date. Pass the agent's own
 * `todayIso(time_zone)` so the quote turns over at their midnight. */
export function quoteForDate(iso: string): Quote {
  const n = QUOTES.length;
  return QUOTES[((dayIndex(iso) % n) + n) % n];
}
