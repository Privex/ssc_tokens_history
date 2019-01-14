require('dotenv').config();
const { Pool } = require('pg');
const nodeCleanup = require('node-cleanup');
const fs = require('fs-extra');
const SSC = require('sscjs');
const config = require('./config');

const ssc = new SSC(config.node);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const SSCChainPollingTime = 3000;
const TOKENS_CONTRACT_NAME = 'tokens';
const TRANSFER = 'transfer';
const TRANSFER_TO_CONTRACT = 'transferToContract';
const TRANSFER_FROM_CONTRACT = 'transferFromContract';

let { lastSSCBlockParsed } = config; // eslint-disable-line prefer-const

async function parseBlock(block) {
  console.log(`parsing block #${block.blockNumber}`); // eslint-disable-line no-console

  const { transactions, timestamp } = block;
  const nbTxs = transactions.length;

  for (let index = 0; index < nbTxs; index += 1) {
    const tx = transactions[index];

    const {
      transactionId,
      logs,
    } = tx;

    const logsObj = JSON.parse(logs);

    if (logsObj) {
      const { events } = logsObj;

      if (events && events.length > 0) {
        let txToSave = false;
        let values;
        const nbEvents = events.length;

        for (let idx = 0; index < nbEvents; index += 1) {
          const ev = events[idx];

          if (ev.contract === TOKENS_CONTRACT_NAME) {
            const {
              from,
              to,
              symbol,
              quantity,
            } = ev.data;

            if (ev.event === TRANSFER) {
              values = [transactionId, timestamp, symbol, from, 'user', to, 'user', quantity];

              txToSave = true;
            } else if (ev.event === TRANSFER_TO_CONTRACT) {
              values = [transactionId, timestamp, symbol, from, 'user', to, 'contract', quantity];

              txToSave = true;
            } else if (ev.event === TRANSFER_FROM_CONTRACT) {
              values = [transactionId, timestamp, symbol, from, 'contract', to, 'user', quantity];

              txToSave = true;
            }

            if (txToSave) {
              // add the transaction to the history
              const query = 'INSERT INTO transactions("txid", "timestamp", "symbol", "from", "from_type", "to", "to_type", "quantity") VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)';
              await pool.query(query, values); // eslint-disable-line no-await-in-loop
            }
          }
        }
      }
    }
  }

  lastSSCBlockParsed = block.blockNumber;
}

async function parseSSCChain(blockNumber) {
  const block = await ssc.getBlockInfo(blockNumber);
  let newBlockNumber = blockNumber;

  if (block !== null) {
    newBlockNumber += 1;
    await parseBlock(block);

    setTimeout(() => parseSSCChain(newBlockNumber), SSCChainPollingTime);
  } else {
    setTimeout(() => parseSSCChain(newBlockNumber), SSCChainPollingTime);
  }
}

parseSSCChain(lastSSCBlockParsed);

// graceful app closing
nodeCleanup((exitCode, signal) => { // eslint-disable-line no-unused-vars
  console.log('start saving conf'); // eslint-disable-line no-console
  const conf = fs.readJSONSync('./config.json');
  conf.lastSSCBlockParsed = lastSSCBlockParsed;
  fs.writeJSONSync('./config.json', conf);
  pool.end();
  console.log('done saving conf'); // eslint-disable-line no-console
});