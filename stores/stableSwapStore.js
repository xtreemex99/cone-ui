import {ACTIONS, CONTRACTS, ROUTE_ASSETS} from "./constants";
import {formatBN, removeDuplicate} from "../utils";
import stores from "./";

import BigNumber from "bignumber.js";
import router from "next/router";
import {getNftById, getVeApr, loadNfts, updateVestNFTByID} from "./helpers/ve-helper";
import {enrichPairInfo, getAndUpdatePair, getPairs, loadPair} from "./helpers/pair-helper";
import {removeBaseAsset, saveLocalAsset} from "./helpers/local-storage-helper";
import {getBalancesForBaseAssets, getBaseAssets, getOrCreateBaseAsset, getTokenBalance} from "./helpers/token-helper";
import {enrichBoostedApr} from "./helpers/boost-helper";
import {
  createGauge,
  createPairDeposit,
  removeLiquidity,
  stakeLiquidity,
  unstakeLiquidity
} from "./helpers/deposit-helper";
import {quoteAddLiquidity, quoteRemoveLiquidity, quoteSwap} from "./helpers/router-helper";
import {swap, unwrap, wrap} from "./helpers/swap-helper";
import {createVest, increaseVestAmount, increaseVestDuration, merge, withdrawVest} from "./helpers/vest-helper";
import {getVestVotes, resetVote, vote} from "./helpers/voter-helper";
import {createBribe} from "./helpers/bribe-helper";
import {
  claimAllRewards,
  claimBribes,
  claimPairFees,
  claimRewards,
  claimVeDist,
  getRewardBalances
} from "./helpers/reward-helper";
import {searchWhitelist, whitelistToken} from "./helpers/whitelist-helpers";

class Store {
  constructor(dispatcher, emitter) {
    this.dispatcher = dispatcher;
    this.emitter = emitter;

    this.store = {
      baseAssets: [],
      govToken: null,
      veToken: null,
      pairs: [],
      vestNFTs: [],
      migratePair: [],
      rewards: {
        bribes: [],
        fees: [],
        rewards: [],
      },
      apr: [],
    };

    dispatcher.register(
      function (payload) {
        switch (payload.type) {
          case ACTIONS.CONFIGURE_SS:
            this.configure(payload);
            break;
          case ACTIONS.GET_BALANCES:
            this.getBalances();
            break;

          // LIQUIDITY
          case ACTIONS.CREATE_PAIR_AND_DEPOSIT:
            this.createPairDeposit(payload);
            break;
          case ACTIONS.ADD_LIQUIDITY:
            this.addLiquidity(payload);
            break;
          case ACTIONS.STAKE_LIQUIDITY:
            this.stakeLiquidity(payload);
            break;
          case ACTIONS.QUOTE_ADD_LIQUIDITY:
            this.quoteAddLiquidity(payload);
            break;
          case ACTIONS.REMOVE_LIQUIDITY:
            this.removeLiquidity(payload);
            break;
          case ACTIONS.QUOTE_REMOVE_LIQUIDITY:
            this.quoteRemoveLiquidity(payload);
            break;
          case ACTIONS.UNSTAKE_LIQUIDITY:
            this.unstakeLiquidity(payload);
            break;
          case ACTIONS.CREATE_GAUGE:
            this.createGauge(payload);
            break;

          // SWAP
          case ACTIONS.QUOTE_SWAP:
            this.quoteSwap(payload);
            break;
          case ACTIONS.SWAP:
            this.swap(payload);
            break;
          case ACTIONS.WRAP:
            this.wrap(payload);
            break;
          case ACTIONS.UNWRAP:
            this.unwrap(payload);
            break;

          // VESTING
          case ACTIONS.GET_VEST_NFTS:
            this.getVestNFTs(payload);
            break;
          case ACTIONS.CREATE_VEST:
            this.createVest(payload);
            break;
          case ACTIONS.INCREASE_VEST_AMOUNT:
            this.increaseVestAmount(payload);
            break;
          case ACTIONS.INCREASE_VEST_DURATION:
            this.increaseVestDuration(payload);
            break;
          case ACTIONS.MERGE_NFT:
            this.merge(payload);
            break;
          case ACTIONS.WITHDRAW_VEST:
            this.withdrawVest(payload);
            break;

          //VOTE
          case ACTIONS.VOTE:
            this.vote(payload);
            break;
          case ACTIONS.RESET_VOTE:
            this.resetVote(payload);
            break;
          case ACTIONS.GET_VEST_VOTES:
            this.getVestVotes(payload);
            break;
          case ACTIONS.CREATE_BRIBE:
            this.createBribe(payload);
            break;

          //REWARDS
          case ACTIONS.GET_REWARD_BALANCES:
            this.getRewardBalances(payload);
            break;
          case ACTIONS.CLAIM_BRIBE:
            this.claimBribes(payload);
            break;
          case ACTIONS.CLAIM_PAIR_FEES:
            this.claimPairFees(payload);
            break;
          case ACTIONS.CLAIM_REWARD:
            this.claimRewards(payload);
            break;
          case ACTIONS.CLAIM_VE_DIST:
            this.claimVeDist(payload);
            break;
          case ACTIONS.CLAIM_ALL_REWARDS:
            this.claimAllRewards(payload);
            break;

          //WHITELIST
          case ACTIONS.SEARCH_WHITELIST:
            this.searchWhitelist(payload);
            break;
          case ACTIONS.WHITELIST_TOKEN:
            this.whitelistToken(payload);
            break;
          default: {
          }
        }
      }.bind(this)
    );
  }

  // DISPATCHER FUNCTIONS
  configure = async () => {
    this.setStore({
      govToken: {
        address: CONTRACTS.GOV_TOKEN_ADDRESS,
        name: CONTRACTS.GOV_TOKEN_NAME,
        symbol: CONTRACTS.GOV_TOKEN_SYMBOL,
        decimals: CONTRACTS.GOV_TOKEN_DECIMALS,
        logoURI: CONTRACTS.GOV_TOKEN_LOGO,
      }
    });

    this.setStore({veToken: await this._getVeTokenBase()});
    this.setStore({routeAssets: ROUTE_ASSETS});
    this.setStore({baseAssets: await getBaseAssets()});
    await this.refreshPairs()
    await this.getBalances();
    await this.getVestNFTs();

    this.emitter.emit(ACTIONS.UPDATED);
    this.emitter.emit(ACTIONS.CONFIGURED_SS);
  };

  getStore = (index) => {
    return this.store[index];
  };

  setStore = (obj) => {
    this.store = {...this.store, ...obj};
    return this.emitter.emit(ACTIONS.STORE_UPDATED);
  };

  getAccount() {
    const account = stores.accountStore.getStore("account");
    if (!account) {
      console.warn("account not found");
      return null;
    }
    return account;
  }

  async getWeb3() {
    const web3 = await stores.accountStore.getWeb3Provider();
    if (!web3) {
      console.warn("web3 not found");
      return null;
    }
    return web3;
  }

  getNFTByID = async (id) => {
    const nft = getNftById(id, this.getStore("vestNFTs"));
    if (nft !== null) {
      return nft;
    }
    const nfts = await loadNfts(this.getAccount(), await this.getWeb3());
    this.setStore({vestNFTs: nfts});
    return getNftById(id, nfts);
  };

  getVestNFTs = async () => {
    const nfts = await loadNfts(this.getAccount(), await this.getWeb3());
    this.setStore({vestNFTs: nfts});
    this.emitter.emit(ACTIONS.VEST_NFTS_RETURNED, nfts);
    return nfts;
  };

  getPairByAddress = async (pairAddress) => {
    const pairs = this.getStore("pairs");
    const pair = await getAndUpdatePair(pairAddress, await this.getWeb3(), this.getAccount(), pairs);
    this.setStore({pairs: pairs ?? []});
    return pair;
  };

  getPair = async (addressA, addressB, stab) => {
    const pairs = this.getStore("pairs");
    const pair = await loadPair(addressA, addressB, stab, await this.getWeb3(), this.getAccount(), pairs, this.getStore("baseAssets"))
    this.setStore({pairs: pairs ?? []});
    return pair;
  };

  _getPairInfo = async (web3, account, overridePairs) => {
    let pairs;
    if (overridePairs) {
      pairs = overridePairs;
    } else {
      pairs = this.getStore("pairs");
    }
    pairs = await enrichPairInfo(web3, account, pairs, await stores.accountStore.getMulticall(), this.getStore("baseAssets"));
    await enrichBoostedApr(pairs)
    this.setStore({pairs: pairs ?? []});
    this.emitter.emit(ACTIONS.UPDATED);
  };

  refreshPairs = async () => {
    let pairs = await getPairs();
    pairs = await enrichPairInfo(
      await this.getWeb3(),
      this.getAccount(),
      pairs,
      await stores.accountStore.getMulticall(),
      this.getStore("baseAssets")
    );
    this.setStore({pairs: pairs});
  };

  removeBaseAsset = (asset) => {
    const baseAssets = removeDuplicate(removeBaseAsset(asset, this.getStore("baseAssets")));
    this.setStore({baseAssets: baseAssets});
    this.emitter.emit(ACTIONS.BASE_ASSETS_UPDATED, baseAssets);
  };

  getBaseAsset = async (address, save, getBalance) => {
    if (!address) {
      return null;
    }
    try {
      const baseAssets = this.getStore("baseAssets");
      const newBaseAsset = await getOrCreateBaseAsset(baseAssets, address, await this.getWeb3(), this.getAccount(), getBalance);

      //only save when a user adds it. don't for when we look up a pair and find his asset.
      if (save) {
        saveLocalAsset(newBaseAsset);
        const storeBaseAssets = removeDuplicate([...baseAssets, newBaseAsset]);
        this.setStore({baseAssets: storeBaseAssets});
        this.emitter.emit(ACTIONS.BASE_ASSETS_UPDATED, storeBaseAssets);
      }
      return newBaseAsset;
    } catch (ex) {
      console.log("Get base asset error", ex);
      return null;
    }
  };

  _getVeTokenBase = async () => {
    return {
      address: CONTRACTS.VE_TOKEN_ADDRESS,
      name: CONTRACTS.VE_TOKEN_NAME,
      symbol: CONTRACTS.VE_TOKEN_SYMBOL,
      decimals: CONTRACTS.VE_TOKEN_DECIMALS,
      logoURI: CONTRACTS.VE_TOKEN_LOGO,
      veDistApr: await getVeApr(),
    };
  };

  getBalances = async () => {
    try {
      await this._refreshGovTokenInfo(await this.getWeb3(), this.getAccount());
      await this._getBaseAssetInfo(await this.getWeb3(), this.getAccount());
      await this._getPairInfo(await this.getWeb3(), this.getAccount());
    } catch (ex) {
      console.log("Get balances fail", ex);
      this.emitter.emit(ACTIONS.ERROR, ex);
    }
  };

  _refreshGovTokenInfo = async (web3, account) => {
    try {
      const govToken = this.getStore("govToken");
      govToken.balanceOf = await getTokenBalance(govToken.address, web3, account.address, govToken.decimals);
      govToken.balance = formatBN(govToken.balanceOf, govToken.decimals)
      this.setStore({govToken});
    } catch (ex) {
      console.log("Get gov token info error", ex);
    }
  };

  _getBaseAssetInfo = async (web3, account) => {
    const baseAssets = this.getStore("baseAssets");
    await getBalancesForBaseAssets(web3, account, baseAssets, await stores.accountStore.getMulticall())
    this.setStore({baseAssets});
    this.emitter.emit(ACTIONS.UPDATED);
  };

  createPairDeposit = async (payload) => {
    const {token0, token1, amount0, amount1, isStable, slippage} = payload.content;
    await createPairDeposit(
      token0,
      token1,
      amount0,
      amount1,
      isStable,
      slippage,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
      true,
      async () => await this.refreshPairs()
    );
  };

  addLiquidity = async (payload) => {
    const {token0, token1, amount0, amount1, pair, slippage} = payload.content;
    await createPairDeposit(
      token0,
      token1,
      amount0,
      amount1,
      pair.stable,
      slippage,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
      false,
      async () => await this.refreshPairs()
    );
  };

  stakeLiquidity = async (payload) => {
    await stakeLiquidity(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
      async () => await this.refreshPairs()
    )
  };

  quoteAddLiquidity = async (payload) => {
    await quoteAddLiquidity(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
    )
  };

  removeLiquidity = async (payload) => {
    await removeLiquidity(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
      async () => await this.refreshPairs()
    )
  };

  unstakeLiquidity = async (payload) => {
    await unstakeLiquidity(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
      async () => await this.refreshPairs()
    )
  };

  quoteRemoveLiquidity = async (payload) => {
    await quoteRemoveLiquidity(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
    )
  };

  createGauge = async (payload) => {
    await createGauge(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
      async () => await this.refreshPairs()
    )
  };

  quoteSwap = async (payload) => {
    await quoteSwap(
      payload,
      await this.getWeb3(),
      this.getStore("routeAssets"),
      this.emitter,
      this.getStore("baseAssets")
    )
  };

  swap = async (payload) => {
    await swap(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
      async (web3, account, fromAsset, toAsset) => {
        await this._getSpecificAssetInfo(web3, account, fromAsset.address);
        await this._getSpecificAssetInfo(web3, account, toAsset.address);
        await this._getPairInfo(web3, account);
      }
    )
  };

  wrap = async (payload) => {
    await wrap(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
      async (web3, account, fromAsset, toAsset) => {
        await this._getSpecificAssetInfo(web3, account, fromAsset.address);
        await this._getSpecificAssetInfo(web3, account, toAsset.address);
        await this._getPairInfo(web3, account);
      }
    )
  };

  unwrap = async (payload) => {
    await unwrap(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
      async (web3, account, fromAsset, toAsset) => {
        await this._getSpecificAssetInfo(web3, account, fromAsset.address);
        await this._getSpecificAssetInfo(web3, account, toAsset.address);
        await this._getPairInfo(web3, account);
      }
    )
  };

  // todo remove
  _getSpecificAssetInfo = async (web3, account, assetAddress) => {
    try {
      const baseAssets = this.getStore("baseAssets");
      if (!baseAssets) {
        console.warn("baseAssets not found");
        return null;
      }

      const ba = await Promise.all(
        baseAssets.map(async (asset) => {
          if (asset.address.toLowerCase() === assetAddress.toLowerCase()) {
            if (asset.address === "BNB") {
              let bal = await web3.eth.getBalance(account.address);
              asset.balance = BigNumber(bal)
                .div(10 ** parseInt(asset.decimals))
                .toFixed(parseInt(asset.decimals));
            } else {
              const assetContract = new web3.eth.Contract(
                CONTRACTS.ERC20_ABI,
                asset.address
              );

              const [balanceOf] = await Promise.all([
                assetContract.methods.balanceOf(account.address).call(),
              ]);

              asset.balance = BigNumber(balanceOf)
                .div(10 ** parseInt(asset.decimals))
                .toFixed(parseInt(asset.decimals));
            }
          }

          return asset;
        })
      );

      this.setStore({baseAssets: removeDuplicate(ba)});
      this.emitter.emit(ACTIONS.UPDATED);
    } catch (ex) {
      console.log(ex);
      return null;
    }
  };

  createVest = async (payload) => {
    await createVest(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
      this.getStore("govToken"),
      async (web3, account) => {
        await this._refreshGovTokenInfo(web3, account);
        await this.getNFTByID("fetchAll");
      }
    )
  };

  increaseVestAmount = async (payload) => {
    await increaseVestAmount(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
      this.getStore("govToken"),
      async (web3, account) => {
        await this._refreshGovTokenInfo(web3, account);
        await this.getNFTByID("fetchAll");
      }
    )
  };

  increaseVestDuration = async (payload) => {
    await increaseVestDuration(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
      this.getStore("govToken"),
      async (tokenID) => {
        await this.getNFTByID(tokenID);
      }
    )
  };

  withdrawVest = async (payload) => {
    await withdrawVest(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
      async () => {
        await this.getNFTByID("fetchAll");
      }
    )
  };

  merge = async (payload) => {
    await merge(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
      async () => {
        await this.getNFTByID("fetchAll");
        await router.push("/vest");
      }
    )
  };

  vote = async (payload) => {
    await vote(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
    )
  };

  resetVote = async (payload) => {
    await resetVote(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
    )
  };

  getVestVotes = async (payload) => {
    await getVestVotes(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.getStore("pairs"),
      await stores.accountStore.getMulticall(),
      false // set true if any issues with subgraph
    )
  };

  createBribe = async (payload) => {
    await createBribe(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
      async () => await this.refreshPairs()
    );
  };

  getRewardBalances = async (payload) => {
    const rewards = await getRewardBalances(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.getStore("pairs"),
      this.getStore("veToken"),
      this.getStore("govToken"),
      this.getStore("vestNFTs"),
      this.getStore("baseAssets"),
      await stores.accountStore.getMulticall(),
    );
    this.setStore({rewards});
    this.emitter.emit(ACTIONS.REWARD_BALANCES_RETURNED, rewards);
  };

  claimBribes = async (payload) => {
    await claimBribes(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
      async (tokenID) => await this.getRewardBalances({content: {tokenID}})
    )
  };

  claimAllRewards = async (payload) => {
    await claimAllRewards(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
      async (tokenID) => await this.getRewardBalances({content: {tokenID}})
    )
  };

  claimRewards = async (payload) => {
    await claimRewards(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
      async (tokenID) => await this.getRewardBalances({content: {tokenID}})
    )
  };

  claimVeDist = async (payload) => {
    await claimVeDist(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
      async (tokenID) => await this.getRewardBalances({content: {tokenID}})
    )
  };

  claimPairFees = async (payload) => {
    await claimPairFees(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
      async (tokenID) => await this.getRewardBalances({content: {tokenID}})
    )
  };

  searchWhitelist = async (payload) => {
    await searchWhitelist(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      async (search) => await this.getBaseAsset(search)
    );
  };

  whitelistToken = async (payload) => {
    await whitelistToken(
      payload,
      this.getAccount(),
      await this.getWeb3(),
      this.emitter,
      this.dispatcher,
      await stores.accountStore.getGasPrice(),
      async (dispatcher, token) => {
        window.setTimeout(() => {
          dispatcher.dispatch({
            type: ACTIONS.SEARCH_WHITELIST,
            content: {search: token.address},
          });
        }, 2);
      }
    )
  };
}

export default Store;
