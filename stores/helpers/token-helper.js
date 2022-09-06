import DEFAULT_TOKEN_LIST from './../constants/tokenlists/pancakeswap-extended.json'
import {
  ACTIONS,
  BASE_ASSETS_WHITELIST,
  BLACK_LIST_TOKENS,
  CONE_ADDRESS,
  CONTRACTS, NETWORK_TOKEN,
  QUERIES,
  RENAME_ASSETS
} from "./../constants";
import {formatBN, removeDuplicate} from '../../utils';
import axios from "axios";
import {getLocalAssets} from "./local-storage-helper";
import {createClient} from "urql";
import BigNumber from "bignumber.js";
import stores from "../index";

const client = createClient({url: process.env.NEXT_PUBLIC_API});

export function getTokenContract(web3, address) {
  return new web3.eth.Contract(
    CONTRACTS.ERC20_ABI,
    address
  );
}

export async function getEthPrice() {
  return parseFloat((await client.query(QUERIES.bundleQuery).toPromise()).data.bundle.ethPrice);
}

export async function getTokenBalance(tokenAdr, web3, accountAdr, decimals) {
  if (!tokenAdr || !web3 || !accountAdr) {
    return "0";
  }
  try {
    return formatBN(await getTokenContract(web3, tokenAdr).methods.balanceOf(accountAdr).call(), decimals);
  } catch (e) {
    console.log("Error get balance", tokenAdr, accountAdr, e)
    return "0";
  }
}

export async function getOrCreateBaseAsset(baseAssets, token, web3, account, getBalance) {
  if (!token || !web3 || !account) {
    return null;
  }
  const theBaseAsset = baseAssets.filter(as => as?.address?.toLowerCase() === token?.toLowerCase()).reduce((a, b) => b, null);
  if (theBaseAsset !== null) {
    return theBaseAsset;
  }
  return await createBaseAsset(token, web3, account, getBalance);
}

export const createBaseAsset = async (address, web3, account, getBalance) => {
  try {
    const baseAssetContract = getTokenContract(web3, address);

    const [symbol, decimals, name] = await Promise.all([
      baseAssetContract.methods.symbol().call(),
      baseAssetContract.methods.decimals().call(),
      baseAssetContract.methods.name().call(),
    ]);

    return {
      address: address,
      symbol: symbol,
      name: name,
      decimals: parseInt(decimals),
      logoURI: null,
      local: true,
      balance: getBalance ? await getTokenBalance(address, web3, account, decimals) : null
    };
  } catch (ex) {
    console.log("Create base asset error", ex);
    return null;
  }
};

async function getTokenList() {
  if (parseInt(process.env.NEXT_PUBLIC_CHAINID) === 80001) {
    // some test token list
  } else {
    /*await axios.get(
     `https://raw.githubusercontent.com/cone-exchange/token-list/main/lists/pancakeswap-extended.json`
   )*/
    return {data: DEFAULT_TOKEN_LIST,}
  }
}

async function getTokensFromSubgraph() {
  const resp = await client.query(QUERIES.tokensQuery).toPromise();
  if (!!resp.error) {
    console.log("Token query error", resp.error);
  } else {
    // console.log('Token query', resp)
  }
  return resp.data.tokens;
}

export const getBaseAssets = async () => {
  try {
    let baseAssets = await getTokensFromSubgraph();
    const defaultTokenList = await getTokenList();

    for (let i = 0; i < defaultTokenList.data.tokens.length; i++) {
      for (let j = 0; j < baseAssets.length; j++) {
        baseAssets[j].address = baseAssets[j].id
        baseAssets[j].balance = 0
        baseAssets[j].chainId = 0

        if (defaultTokenList.data.tokens[i].address?.toLowerCase() === baseAssets[j].address.toLowerCase()) {
          baseAssets[j].logoURI = defaultTokenList.data.tokens[i].logoURI;
        }

        if (baseAssets[j].address.toLowerCase() === CONE_ADDRESS) {
          baseAssets[j].logoURI = 'https://icons.llama.fi/cone.png'
        }

        if (RENAME_ASSETS[baseAssets[j].name]) {
          baseAssets[j].symbol = RENAME_ASSETS[baseAssets[j].name];
          baseAssets[j].name = RENAME_ASSETS[baseAssets[j].name];
        }
      }
    }
    // todo a bit mess with cases, need to keep only 1 constant for each value
    const nativeFTM = {
      id: CONTRACTS.FTM_ADDRESS,
      address: CONTRACTS.FTM_ADDRESS,
      decimals: CONTRACTS.FTM_DECIMALS,
      logoURI: CONTRACTS.FTM_LOGO,
      name: CONTRACTS.FTM_NAME,
      symbol: CONTRACTS.FTM_SYMBOL,
    };
    baseAssets.unshift(nativeFTM);

    let localBaseAssets = getLocalAssets();

    baseAssets = baseAssets.filter((token) => BLACK_LIST_TOKENS.indexOf(token.id?.toLowerCase()) === -1);
    let dupAssets = [];
    baseAssets.forEach((token, id) => {
      BASE_ASSETS_WHITELIST.forEach((wl) => {
        if (token.id?.toLowerCase() !== wl.address?.toLowerCase()
          && wl.symbol?.toLowerCase() === token.symbol?.toLowerCase()) {
          dupAssets.push(id);
        }
      });
    });
    for (var i = dupAssets.length - 1; i >= 0; i--)
      baseAssets.splice(dupAssets[i], 1);
    return removeDuplicate([...localBaseAssets, ...baseAssets]);
  } catch (ex) {
    console.log(ex);
    return [];
  }
};

export const getBalancesForBaseAssets = async (web3, account, baseAssets, multicall) => {
  try {
    let batch = [];
    let tokens = [];
    for (let i = 0; i < baseAssets.length; i++) {
      const asset = baseAssets[i];
      if (asset.address === "BNB") {
        asset.balance = formatBN(await web3.eth.getBalance(account));
        continue;
      }

      batch.push(getTokenContract(web3, asset.address).methods.balanceOf(account))
      tokens.push(asset.address)
      if (batch.length > 30) {
        const results = await multicall.aggregate(batch);
        tokens.forEach((token, i) => {
          const a = baseAssets.filter(a => a.address === token)[0]
          a.balance = formatBN(results[i], a.decimals);
        })
        batch = [];
        tokens = [];
      }
    }

    const results = await multicall.aggregate(batch);
    tokens.forEach((token, i) => {
      const a = baseAssets.filter(a => a.address === token)[0]
      a.balance = formatBN(results[i], a.decimals);
    })
  } catch (ex) {
    console.log("Get base asset info error", ex);
  }
};

export const getTokenAllowance = async (web3, token, account, spender) => {
  try {
    const tokenContract = getTokenContract(web3, token.address);
    const allowance = await tokenContract.methods
      .allowance(account, spender)
      .call();
    return formatBN(allowance, token.decimals);
  } catch (ex) {
    console.error("Get token allowance error", ex);
    return null;
  }
};

export function enrichLogoUri(baseAssets, tokenModel) {
  const asset = baseAssets.filter(a => a.id.toLowerCase() === tokenModel.id.toLowerCase())[0]
  tokenModel.logoURI = asset?.logoURI;
}

// export const getLiquidityBalances = async (
//   pair,
//   web3,
//   account,
//   emitter,
//   multicall,
// ) => {
//   try {
//     if (!pair || !web3 || !account) {
//       return;
//     }
//
//     const token0Contract = getTokenContract(web3, pair.token0.address);
//     const token1Contract = getTokenContract(web3, pair.token1.address);
//     const pairContract = getTokenContract(web3, pair.address);
//
//     const balanceCalls = [
//       token0Contract.methods.balanceOf(account.address).call(),
//       token1Contract.methods.balanceOf(account.address).call(),
//       pairContract.methods.balanceOf(account.address).call(),
//     ];
//
//     if (pair.gauge) {
//       const gaugeContract = getTokenContract(web3, pair.gauge.address);
//       balanceCalls.push(gaugeContract.methods.balanceOf(account.address).call());
//     }
//
//     const [
//       token0Balance,
//       token1Balance,
//       poolBalance,
//       gaugeBalance,
//     ] = await multicall.aggregate(balanceCalls);
//
//     const result = {
//       token0: formatBN(token0Balance, pair.token0.decimals),
//       token1: formatBN(token1Balance, pair.token1.decimals),
//       pool: formatBN(poolBalance)
//     };
//
//     if (pair.gauge) {
//       result.gauge = gaugeBalance ? formatBN(gaugeBalance) : null;
//     }
//
//     this.emitter.emit(ACTIONS.GET_LIQUIDITY_BALANCES_RETURNED, result);
//   } catch (ex) {
//     console.error("getLiquidityBalances error", ex);
//     this.emitter.emit(ACTIONS.ERROR, ex);
//   }
// };
