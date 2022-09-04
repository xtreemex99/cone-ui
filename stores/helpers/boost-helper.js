import axios from "axios";
import BigNumber from "bignumber.js";
import {CONTRACTS} from "./../constants";

let usdPlusBoost = null;

export async function enrichBoostedApr(pairs) {
  if (pairs) {
    let boostedAprResponse = await usdPlusBoostedAprQuery();
    await Promise.all(pairs.map(async pair => {
      await usdPlusBoostedApr(pair, boostedAprResponse)
    }));
  }
}

async function usdPlusBoostedAprQuery() {
  if (usdPlusBoost === null) {
    // usdPlusBoost = undefined;
    const resp = await axios.get(CONTRACTS.USD_PLUS_BOOSTED_DATA_URL);
    if (resp && resp.data) {
      usdPlusBoost = resp;
    } else {
      usdPlusBoost = null
    }
  }
  return usdPlusBoost;
}

async function usdPlusBoostedApr(pair, boostedAprResponse) {
  const reserve0ETH = BigNumber(parseFloat(pair.reserve0)).times(pair.token0.derivedETH)
  const reserve1ETH = BigNumber(parseFloat(pair.reserve1)).times(pair.token1.derivedETH)
  if (pair.token0.address?.toLowerCase() === CONTRACTS.USD_PLUS_ADDRESS.toLowerCase()) {
    // setTimeout(async () => {
    try {

      if (boostedAprResponse?.data) {
        pair.gauge.boostedApr0 = BigNumber(boostedAprResponse.data).times(100)
          .times(reserve0ETH).div(reserve0ETH.plus(reserve1ETH)).toString();
      }
    } catch (e) {
      console.log("Error load usd+ boosted apr", e);
    }
    // }, usdPlusBoost === null ? 1 : 3000);
  }
  if (pair.token1.address?.toLowerCase() === CONTRACTS.USD_PLUS_ADDRESS.toLowerCase()) {
    // setTimeout(async () => {
    try {

      if (boostedAprResponse?.data) {
        pair.gauge.boostedApr1 = BigNumber(boostedAprResponse.data).times(100)
          .times(reserve1ETH).div(reserve0ETH.plus(reserve1ETH)).toString();
      }
    } catch (e) {
      console.log("Error load usd+ boosted apr", e);
    }
    // }, usdPlusBoost === null ? 1 : 3000);
  }
}
