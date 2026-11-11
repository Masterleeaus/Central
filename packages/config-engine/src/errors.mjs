export class ConfigError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
  }
}
export const fail = (code) => { throw new ConfigError(code); };
