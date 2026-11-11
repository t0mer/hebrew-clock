export interface Env {
  /** Seconds added to the displayed time (Docker: DISPLAY_LAG). */
  DISPLAY_LAG: string;
  /** wttr.in base URL (Docker: WTTR_URL). */
  WTTR_URL: string;
  /** Optional Google Analytics measurement id (Docker: GTAG_ID). */
  GTAG_ID: string;
  ASSETS: Fetcher;
}
