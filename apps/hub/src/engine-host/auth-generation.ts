export interface AuthGeneration {
  current(): number;
  bump(): void;
}

export function createAuthGeneration(): AuthGeneration {
  let generation = 0;
  return {
    current: () => generation,
    bump() {
      generation += 1;
    },
  };
}

export const AUTH_EVENTS = ['DeviceRevoked', 'DeviceTokenRotated', 'SessionEnded', 'StaffDirectoryApplied'] as const;
