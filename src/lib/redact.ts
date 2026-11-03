/**
 * Credential redaction for Q&A text extracted from support tickets (DIS-230).
 *
 * Agents sometimes give customers a temporary password or candidate login in the ticket.
 * The extractor is told to keep "exact values", so those passwords ended up in qa_pairs and
 * the CS bot could quote one customer's password to another. Everything that writes a
 * qa_pair from ticket text runs through redactQAFields() before it reaches the database.
 *
 * Only the secret value is replaced; the sentence around it stays as is.
 */

export const TEMP_PASSWORD_REDACTED = "[temporary password redacted]";
export const PASSWORD_REDACTED = "[password redacted]";

// A secret value: 4-60 chars without spaces, quotes, brackets or list separators, with at
// least one digit or one of !@#$%^&*= (so "reset link", "change?" etc. are left alone).
// Starts with a letter or digit and does not end in a period, so "Password: Abc123!." keeps
// the sentence period.
const VALUE = String.raw`(?=[^\s"'“”‘’()\[\]{},;]*[0-9!@#$%^&*=])[A-Za-z0-9][^\s"'“”‘’()\[\]{},;]{2,58}[^\s"'“”‘’()\[\]{},;.?]`;

const LABEL =
  String.raw`(?:(?<temp>temp(?:orary)?|single[- ]use|one[- ]time|new|default|initial),?\s+(?:(?:one[- ]time|login)\s+)?)?` +
  String.raw`(?:pass(?:word|code)s?|pwd)`;

// "temporary password (Abc123!)", "temporary password ('Abc123!')", "Password: Abc123!",
// "password is Abc123!", "pwd = Abc123!"
const LABELED = new RegExp(
  String.raw`\b${LABEL}\s*(?:\(s\))?\s*,?\s*(?:(?:is|was|of|set to|to|=|:)\s*)?[(\["'“‘]{0,2}\s*(?<value>${VALUE})`,
  "gi"
);

// Same sentence, a few words later: "password for the account to 'Abc123!'",
// "temporary password provided was 'Abc123!'", "your password has been set to Abc123!"
const NEARBY = new RegExp(
  String.raw`\b${LABEL}\b(?:[^.\n'"“‘’]|(?<=\w)['’](?=\w)){0,80}?(?:['"“‘](?<qvalue>${VALUE})['"”’]|\b(?:set to|was|is)\s+(?<value>${VALUE}))`,
  "gi"
);

// "jane@acme.com / Abc123!" (login given as email / password)
const EMAIL_SLASH = new RegExp(
  String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\s*\/\s*(?<value>${VALUE})`,
  "g"
);

const NOT_A_SECRET = /^(?:https?:|www\.)|^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$|^(?:2FA|MFA|SSO|OTP)$/i;

function isSecret(v: string): boolean {
  return (
    !/\s/.test(v) &&
    /[0-9!@#$%^&*=]/.test(v) &&
    !NOT_A_SECRET.test(v) &&
    !/^\d{1,3}$/.test(v) &&
    !/redacted\]?$/.test(v)
  );
}

/** Secret values found in a text, each with the placeholder it should become. */
export function findCredentialValues(text: string | null | undefined): Map<string, string> {
  const found = new Map<string, string>();
  if (!text) return found;
  const add = (value: string | undefined, temp: boolean) => {
    if (!value || !isSecret(value)) return;
    if (!found.has(value) || temp) found.set(value, temp ? TEMP_PASSWORD_REDACTED : PASSWORD_REDACTED);
  };
  for (const re of [LABELED, NEARBY, EMAIL_SLASH]) {
    for (const m of text.matchAll(re)) add(m.groups?.value ?? m.groups?.qvalue, Boolean(m.groups?.temp));
  }
  return found;
}

function replaceAll(text: string, values: Map<string, string>): string {
  let out = text;
  // Longest first so a value that contains another is replaced whole.
  for (const [value, placeholder] of [...values].sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(value).join(placeholder);
  }
  return out;
}

/** Redacts a single text on its own (values are only looked for in this text). */
export function redactCredentials(text: string): string;
export function redactCredentials(text: string | null): string | null;
export function redactCredentials(text: string | null): string | null {
  if (!text) return text;
  const values = findCredentialValues(text);
  return values.size ? replaceAll(text, values) : text;
}

interface QAText {
  question: string;
  question_template: string;
  question_variables: Array<{ name: string; value: string }>;
  answer: string | null;
  resolution_steps: string[];
  summary: string;
}

/**
 * Redacts every text field of an extracted Q&A. A value found next to a password label in
 * any field is also removed where it appears bare in the other fields ("then log in with
 * Abc123!"), and question variables named like a password lose their value.
 */
export function redactQAFields<T extends QAText>(qa: T): T {
  const values = new Map<string, string>();
  const texts = [qa.question, qa.question_template, qa.answer, qa.summary, ...qa.resolution_steps];
  for (const t of texts) for (const [v, p] of findCredentialValues(t)) if (!values.has(v) || p === TEMP_PASSWORD_REDACTED) values.set(v, p);
  for (const qv of qa.question_variables) {
    // Only variables that are a password themselves ("PASSWORD", "TEMP_PASSWORD"), not
    // "CREDENTIAL_TYPE" or "LOGIN_METHOD", and only when the value looks like a secret.
    if (/^(?:temp(?:orary)?_?)?(?:pass(?:word|code)|pwd)$/i.test(String(qv?.name ?? "")) && qv?.value && isSecret(String(qv.value))) {
      if (!values.has(String(qv.value))) values.set(String(qv.value), PASSWORD_REDACTED);
    }
  }
  if (values.size === 0) return qa;
  const r = (s: string) => replaceAll(s, values);
  return {
    ...qa,
    question: r(qa.question),
    question_template: r(qa.question_template),
    question_variables: qa.question_variables.map((qv) => ({ ...qv, value: r(String(qv?.value ?? "")) })),
    answer: qa.answer === null ? null : r(qa.answer),
    resolution_steps: qa.resolution_steps.map(r),
    summary: r(qa.summary),
  };
}
