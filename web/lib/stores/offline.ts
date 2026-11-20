/**
 * What to tell somebody when a request never got an answer: the phone lost
 * the Wi-Fi, the server restarted, or the app was updated underneath them.
 *
 * The save may or may not have happened. That is safe to say because every
 * Stores write carries the browser's request id, and pressing the same button
 * again sends the same id: if the first one was recorded, the database
 * returns it instead of recording a second.
 */
export const NO_ANSWER =
  "The storeroom could not reach the server, so this may or may not have been saved. Check the connection and press the button again: it will not be recorded twice.";
