import BigNumber from "bignumber.js";
import * as moment from "moment/moment";
import {getTokenAllowance} from "./token-helper";
import {callContractWait} from "./web3-helper";
import {v4 as uuidv4} from "uuid";
import {ACTIONS, CONTRACTS, MAX_UINT256} from "./../constants";
import {formatCurrency, parseBN} from '../../utils';

const getTXUUID = () => {
  return uuidv4();
};


export const createVest = async (
  payload,
  account,
  web3,
  emitter,
  dispatcher,
  gasPrice,
  govToken,
  callback
) => {
  try {
    const {amount, unlockTime} = payload.content;

    // ADD TRNASCTIONS TO TRANSACTION QUEUE DISPLAY
    let allowanceTXID = getTXUUID();
    let vestTXID = getTXUUID();

    const unlockString = moment()
      .add(unlockTime, "seconds")
      .format("YYYY-MM-DD");

    emitter.emit(ACTIONS.TX_ADDED, {
      title: `Vest ${govToken.symbol} until ${unlockString}`,
      type: "Vest",
      verb: "Vest Created",
      transactions: [
        {
          uuid: allowanceTXID,
          description: `Checking your ${govToken.symbol} allowance`,
          status: "WAITING",
        },
        {
          uuid: vestTXID,
          description: `Vesting your tokens`,
          status: "WAITING",
        },
      ],
    });

    // CHECK ALLOWANCES AND SET TX DISPLAY
    const allowance = await getTokenAllowance(web3, govToken, account, CONTRACTS.VE_TOKEN_ADDRESS);

    if (BigNumber(allowance).lt(amount)) {
      emitter.emit(ACTIONS.TX_STATUS, {
        uuid: allowanceTXID,
        description: `Allow the vesting contract to use your ${govToken.symbol}`,
      });
    } else {
      emitter.emit(ACTIONS.TX_STATUS, {
        uuid: allowanceTXID,
        description: `Allowance on ${govToken.symbol} sufficient`,
        status: "DONE",
      });
    }

    const allowanceCallsPromises = [];

    // SUBMIT REQUIRED ALLOWANCE TRANSACTIONS
    if (BigNumber(allowance).lt(amount)) {
      const tokenContract = new web3.eth.Contract(
        CONTRACTS.ERC20_ABI,
        govToken.address
      );

      const tokenPromise = new Promise((resolve, reject) => {
        callContractWait(
          web3,
          tokenContract,
          "approve",
          [CONTRACTS.VE_TOKEN_ADDRESS, MAX_UINT256],
          account,
          gasPrice,
          null,
          null,
          allowanceTXID,
          emitter,
          dispatcher,
          (err) => {
            if (err) {
              reject(err);
              return;
            }

            resolve();
          }
        );
      });

      allowanceCallsPromises.push(tokenPromise);
    }

    await Promise.all(allowanceCallsPromises);

    // SUBMIT VEST TRANSACTION
    const sendAmount = parseBN(amount, govToken.decimals);

    const veTokenContract = new web3.eth.Contract(
      CONTRACTS.VE_TOKEN_ABI,
      CONTRACTS.VE_TOKEN_ADDRESS
    );

    await callContractWait(
      web3,
      veTokenContract,
      "createLock",
      [sendAmount, unlockTime + ""],
      account,
      gasPrice,
      null,
      null,
      vestTXID,
      async (err) => {
        if (err) {
          return emitter.emit(ACTIONS.ERROR, err);
        }

        await callback(web3, account);

        emitter.emit(ACTIONS.CREATE_VEST_RETURNED);
      }
    );
  } catch (ex) {
    console.error("Create vest error", ex);
    this.emitter.emit(ACTIONS.ERROR, ex);
  }
};
