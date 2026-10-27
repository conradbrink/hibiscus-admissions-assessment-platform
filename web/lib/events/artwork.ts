/**
 * What an event's page shows around its prices: the headline act and their
 * photo, the line about what happens, and who gets in without a ticket.
 *
 * Kept in the repository, by the event's public address, rather than on
 * `event_sales`: the photo ships with the site in `public/events/<slug>/`,
 * so a change to any of it is a deploy whichever way it is stored. An event
 * with nothing here gets the plain page, as before.
 */

export type EventArtwork = {
  headliner: {
    name: string;
    photo: { src: string; width: number; height: number };
  };
  /** What happens at the event, in one line under its name. */
  billing: string;
  /**
   * Who gets in without a ticket: a row in the prices ("Children: Free") and
   * a line under the price. Null when everybody pays.
   */
  freeEntry: { who: string; note: string } | null;
  /** Confetti falling behind the top of the page, for a celebration. */
  confetti: boolean;
};

const ARTWORK: Record<string, EventArtwork> = {
  // The school's flyer for the show, sent on 27 October 2026.
  "christmas-show": {
    headliner: {
      name: "Vee Mampeezy",
      photo: { src: "/events/christmas-show/vee-mampeezy.jpg", width: 372, height: 456 },
    },
    billing: "Student acts, food and music.",
    freeEntry: { who: "Children", note: "Children get in free. Only adults need a ticket." },
    confetti: true,
  },
};

export function eventArtwork(slug: string): EventArtwork | null {
  return ARTWORK[slug] ?? null;
}
