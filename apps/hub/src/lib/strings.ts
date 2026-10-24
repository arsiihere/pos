// M82, D12: the one English string table for the hub-served pages. Keys follow docs/design/ui-brief.md;
// errors.<CODE> for error codes. Pages show these texts, never a raw key or the server's message.
export const EN = {
  'setup.title': 'Set up this hub',
  'setup.intro': 'Enter the registration code from the cloud. You do this once per hub.',
  'setup.registration_code': 'Registration code',
  'setup.registration_code_help': '12 letters and digits. Dashes and spaces are fine.',
  'setup.registration_code_error': 'Check the code: 12 letters and digits.',
  'setup.advertised_host': 'Hub address on this network',
  'setup.advertised_host_help': 'The IP address screens will use, for example 192.168.0.107.',
  'setup.advertised_host_error': 'This is not an address of this hub. Use its IP on this network.',
  'setup.guest_network_cidrs': 'Guest Wi-Fi networks',
  'setup.guest_network_cidrs_help': 'Ranges that must never reach the POS, separated by commas, for example 192.168.50.0/24.',
  'setup.guest_network_cidrs_error': 'Use ranges like 192.168.50.0/24, separated by commas.',
  'setup.submit': 'Set up hub',
  'setup.slow': 'Still talking to the cloud. This can take up to 10 seconds.',
  'setup.done_title': 'Hub is set up',
  'setup.done_body': 'The hub is restarting. Scan the code to create the first admin.',
  'setup.expires': 'This link works for {min} min.',

  'auth.attempts_left': '{n} tries left',
  'auth.attempts_left_one': '1 try left',
  'auth.locked_for': 'Locked · {min} min',

  'errors.VALIDATION_FAILED': 'Check the highlighted field.',
  'errors.REGISTRATION_CODE_INVALID': 'This code does not work. It may be used or expired. Ask for a new code.',
  'errors.REGISTRATION_CODE_KIND_UNSUPPORTED': 'This code is for replacing a hub. Ask for a new branch code.',
  'errors.SERVICE_UNAVAILABLE': 'The hub is busy or cannot reach the cloud. Try again in a few seconds.',
  'errors.SETUP_IN_PROGRESS': 'Setup is already running. Wait a moment, then try again.',
  'errors.HOST_NOT_ALLOWED': "Open this page using the hub's IP address.",
  'errors.HUB_NOT_PROVISIONED': 'The hub is being set up.',
  'errors.INTERNAL_ERROR': 'Something went wrong on the hub. Try again.',
  'errors.unknown': 'Something went wrong. Try again.',
} as const;

export type StringKey = keyof typeof EN;
