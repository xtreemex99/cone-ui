import {ACTIONS, CONTRACTS, ROUTE_ASSETS} from "./constants";
import {formatBN, parseBN, removeDuplicate} from "../utils";
import stores from "./";
import router from "next/router";
import {getNftById, getVeApr, loadNfts} from "./helpers/ve-helper";
import {enrichPairInfo, getAndUpdatePair, getPairs, loadPair} from "./helpers/pair-helper";
import {removeBaseAsset, saveLocalAsset} from "./helpers/local-storage-helper";
import {getBalancesForBaseAssets, getBaseAssets, getOrCreateBaseAsset, getTokenBalance} from "./helpers/token-helper";
import {enrichAdditionalApr} from "./helpers/additional-apr-helper";
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

const EMPTY_STORE = {
  baseAssets: [],
  govToken: null,
  veToken: null,
  pairs: [],
  vestNFTs: null,
  migratePair: [],
  rewards: {
    bribes: [],
    fees: [],
    rewards: [],
  },
  apr: [],
};

class Store {

  configurationLoading = false;

  constructor(dispatcher, emitter) {
    this.dispatcher = dispatcher;
    this.emitter = emitter;

    this.store = EMPTY_STORE;

    dispatcher.register(
      function (payload) {
        switch (payload.type) {
          case ACTIONS.CONFIGURE_SS:
            this.configure();
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
    // console.log('configure')
    if(this.configurationLoading || this.getAccount() === null) {
      return;
    }
    try {
      this.configurationLoading = true;

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
      await this.getVestNFTs();
      await this.refreshPairs();
      await this._refreshGovTokenInfo(await this.getWeb3(), this.getAccount());
      await this._getBaseAssetInfo(await this.getWeb3(), this.getAccount());

      this.emitter.emit(ACTIONS.UPDATED);
      this.emitter.emit(ACTIONS.CONFIGURED_SS);
    } finally {
      this.configurationLoading = false;
    }
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

  ////////////////////////////////////////////////////////////////
  //                 PAIRS
  ////////////////////////////////////////////////////////////////

  refreshPairs = async () => {
    let pairs = this.getStore("pairs");
    if (!pairs || pairs.length === 0) {
      pairs = await getPairs();
    }
    pairs = await enrichPairInfo(
      await this.getWeb3(),
      this.getAccount(),
      pairs,
      await stores.accountStore.getMulticall(),
      this.getStore("baseAssets"),
      this.getStore("vestNFTs") ?? []
    );
    await enrichAdditionalApr(pairs)
    this.setStore({pairs: pairs});
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

  //////////////////////////////////////////////////////////////
  //                   VE
  //////////////////////////////////////////////////////////////

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

  getNFTByID = async (id) => {
    const existNfts = this.getStore("vestNFTs") ?? [];
    const nft = getNftById(id, existNfts);
    if (nft !== null) {
      return nft;
    }
    const freshNft = await loadNfts(this.getAccount(), await this.getWeb3(), id);
    if (freshNft.length > 0) {
      existNfts.push(...freshNft)
    }
    return getNftById(id, existNfts);
  };

  getVestNFTs = async () => {
    const nfts = await loadNfts(this.getAccount(), await this.getWeb3());
    this.setStore({vestNFTs: nfts});
    this.emitter.emit(ACTIONS.VEST_NFTS_RETURNED, nfts);
    return nfts;
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

  //////////////////////////////////////////////////////////////
  //                   ASSETS
  //////////////////////////////////////////////////////////////

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

  _refreshGovTokenInfo = async (web3, account) => {
    try {
      const govToken = this.getStore("govToken");
      const balance = await getTokenBalance(govToken.address, web3, account, govToken.decimals);
      govToken.balanceOf = parseBN(balance, govToken.decimals);
      govToken.balance = balance
      this.setStore({govToken});
      this.emitter.emit(ACTIONS.GOVERNANCE_ASSETS_UPDATED, govToken);
    } catch (ex) {
      console.log("Get gov token info error", ex);
    }
  };

  _getBaseAssetInfo = async (web3, account) => {
    const baseAssets = this.getStore("baseAssets");
    await getBalancesForBaseAssets(web3, account, baseAssets, await stores.accountStore.getMulticall())
    this.setStore({baseAssets});
    // this.emitter.emit(ACTIONS.UPDATED);
  };

  _refreshAssetBalance = async (web3, account, assetAddress) => {
    try {
      const baseAssets = this.getStore("baseAssets");
      const govToken = this.getStore("govToken");
      const asset = baseAssets?.filter((asset) => asset.address.toLowerCase() === assetAddress.toLowerCase())[0]
      if (!asset) {
        return;
      }
      if (asset.address === "BNB") {
        asset.balance = formatBN(await web3.eth.getBalance(account))
      } else {
        asset.balance = await getTokenBalance(assetAddress, web3, account, asset.decimals)
      }
      if (assetAddress.toLowerCase() === govToken.address.toLowerCase()) {
        await this._refreshGovTokenInfo(web3, account);
      }
      this.emitter.emit(ACTIONS.UPDATED);
    } catch (ex) {
      console.log("Refresh balance error", ex);
    }
  };

  //////////////////////////////////////////////////////////////
  //                   REWARDS
  //////////////////////////////////////////////////////////////

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
      this.getStore("baseAssets") ?? [],
      await stores.accountStore.getMulticall(),
    );
    this.setStore({rewards});
    this.emitter.emit(ACTIONS.REWARD_BALANCES_RETURNED, rewards);
  };

  ////////////////////////////////////////////////////////////////////////////////////////////////
  ////////////////////////////////////////////////////////////////////////////////////////////////
  //                              Transactions calls
  ////////////////////////////////////////////////////////////////////////////////////////////////
  ////////////////////////////////////////////////////////////////////////////////////////////////

  ////////////////////////////////////////////////////////////////////////////////
  //                            LIQUIDITY
  ////////////////////////////////////////////////////////////////////////////////

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

  quoteAddLiquidity = async (payload) => {
    await quoteAddLiquidity(
      payload,
      await this.getWeb3(),
      this.emitter,
    )
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

  quoteRemoveLiquidity = async (payload) => {
    await quoteRemoveLiquidity(
      payload,
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

  ////////////////////////////////////////////////////////////////////////////////
  //                            STAKE
  ////////////////////////////////////////////////////////////////////////////////

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

  ////////////////////////////////////////////////////////////////////////////////
  //                            SWAP
  ////////////////////////////////////////////////////////////////////////////////

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
        await this._refreshAssetBalance(web3, account, fromAsset.address);
        await this._refreshAssetBalance(web3, account, toAsset.address);
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
        await this._refreshAssetBalance(web3, account, fromAsset.address);
        await this._refreshAssetBalance(web3, account, toAsset.address);
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
        await this._refreshAssetBalance(web3, account, fromAsset.address);
        await this._refreshAssetBalance(web3, account, toAsset.address);
      }
    )
  };

  ////////////////////////////////////////////////////////////////////////////////
  //                            VESTING
  ////////////////////////////////////////////////////////////////////////////////

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

  ////////////////////////////////////////////////////////////////////////////////
  //                            VOTES
  ////////////////////////////////////////////////////////////////////////////////

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

  //////////////////////////////////////////////////////////////
  //                   BRIBE
  //////////////////////////////////////////////////////////////

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

  //////////////////////////////////////////////////////////////
  //                   CLAIM
  //////////////////////////////////////////////////////////////

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

  //////////////////////////////////////////////////////////////
  //                   WHITELIST
  //////////////////////////////////////////////////////////////

  searchWhitelist = async (payload) => {
    await searchWhitelist(
      payload,
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
