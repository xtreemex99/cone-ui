import BigNumber from "bignumber.js";
import {ACTIONS} from "./../constants";

export const callContractWait = (
  web3,
  contract,
  method,
  params,
  account,
  gasPrice,
  dispatchEvent,
  dispatchContent,
  uuid,
  emitter,
  dispatcher,
  callback,
  paddGasCost,
  sendValue = null
) => {
  // console.log(method)
  // console.log(params)
  // if(sendValue) {
  //   console.log(sendValue)
  // }
  // console.log(uuid)

  //estimate gas
  emitter.emit(ACTIONS.TX_PENDING, {uuid});

  const gasCost = contract.methods[method](...params)
    .estimateGas({from: account, value: sendValue})
    .then((gasAmount) => {
      const context = this;

      let sendGasAmount = BigNumber(gasAmount).times(1.5).toFixed(0);
      let sendGasPrice = BigNumber(gasPrice).toFixed(0);
      // if (paddGasCost) {
      //   sendGasAmount = BigNumber(sendGasAmount).times(1.15).toFixed(0)
      // }
      //
      // const sendGasAmount = '3000000'
      // const context = this
      //
      contract.methods[method](...params)
        .send({
          from: account,
          gasPrice: web3.utils.toWei(sendGasPrice, "gwei"),
          gas: sendGasAmount,
          value: sendValue,
          // maxFeePerGas: web3.utils.toWei(gasPrice, "gwei"),
          // maxPriorityFeePerGas: web3.utils.toWei("2", "gwei"),
        })
        .on("transactionHash", function (txHash) {
          emitter.emit(ACTIONS.TX_SUBMITTED, {uuid, txHash});
        })
        .on("receipt", function (receipt) {
          emitter.emit(ACTIONS.TX_CONFIRMED, {
            uuid,
            txHash: receipt.transactionHash,
          });
          callback(null, receipt.transactionHash);
          if (dispatchEvent) {
            dispatcher.dispatch({
              type: dispatchEvent,
              content: dispatchContent,
            });
          }
        })
        .on("error", function (error) {
          if (!error.toString().includes("-32601")) {
            if (error.message) {
              emitter.emit(ACTIONS.TX_REJECTED, {
                uuid,
                error: parseRpcError(error.message),
              });
              return callback(error.message);
            }
            emitter.emit(ACTIONS.TX_REJECTED, {uuid, error: error});
            callback(error);
          }
        })
        .catch((error) => {
          if (!error.toString().includes("-32601")) {
            if (error.message) {
              emitter.emit(ACTIONS.TX_REJECTED, {
                uuid,
                error: parseRpcError(error.message),
              });
              return callback(error.message);
            }
            emitter.emit(ACTIONS.TX_REJECTED, {uuid, error: error});
            callback(error);
          }
        });
    })
    .catch((ex) => {
      console.log("Call tx error", ex);
      if (ex.message) {
        emitter.emit(ACTIONS.TX_REJECTED, {uuid, error: parseRpcError(ex.message)});
        return callback(ex.message);
      }
      this.emitter.emit(ACTIONS.TX_REJECTED, {
        uuid,
        error: "Error estimating gas",
      });
      callback(ex);
    });
};

export function excludeErrors(error) {
  const msg = error?.message;
  return !msg?.includes("-32601")
    && !msg?.includes("User denied transaction signature")
}

function parseRpcError(error) {
  return error.reason ? error.reason : error;
}
