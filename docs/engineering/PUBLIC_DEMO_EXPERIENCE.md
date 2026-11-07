# Public portfolio and system demo access

The primary audience is a portfolio visitor. Every project card must expose
separate front-office and back-office demonstrations. Each opens a system login
page, preserving the existing requirement that switching systems shows login.
The login page offers an explicit one-click demo-role action so a visitor does
not have to copy synthetic credentials or create an account.

## Boundaries

- Front/back intent is navigation and presentation only, not authorization.
  Authenticate through the existing station login API using only its published
  synthetic demo accounts. Resolve the resulting role/scope from the server
  before navigating. Never bypass grants or repurpose the private owner account.
- Preserve per-browser demo isolation, all existing manual sign-in behavior,
  read-only restrictions, mobile/workspace previews and document/label previews.
  Prevent duplicate role submissions and surface authentication failures.
- Keep private workspace administration, exports, restore and key issuance
  protected. Remove its homepage promotion; direct protected routes still work.
  Google OAuth/private owner setup is deferred by the user's current priority.
- Retain English default, Traditional Chinese switching, motion accessibility
  and existing click effects. Keep source links and independent system pages.

## Remote acceptance before implementation

Portfolio tests assert six front and six back links, correct login/view URLs,
and no private-administration CTA. Existing private-access rejection remains.
Real Go-server browser tests exercise each system's explicit demo administrator
and front-office login, server-confirmed scope, previews and read-only denial.
Capture screenshots for public UX review in CI. No local tests/builds run.

This improves discovery and public demo entry. It does not prove independent
OCI cutover or complete private OAuth setup.
