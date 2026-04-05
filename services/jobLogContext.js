const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

module.exports = {
  /**
   * @returns {{ appendRaw: (line: string) => void, meta?: object } | undefined}
   */
  getSink() {
    return als.getStore();
  },

  /**
   * @param {object} sink
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async run(sink, fn) {
    return als.run(sink, fn);
  },
};
