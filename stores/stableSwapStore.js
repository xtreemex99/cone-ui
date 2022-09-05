import {ACTIONS, CONTRACTS, MAX_UINT256, QUERIES, ROUTE_ASSETS} from "./constants";
import {v4 as uuidv4} from "uuid";
import {formatBN, removeDuplicate} from "../utils";
import stores from "./";

import BigNumber from "bignumber.js";
import {createClient} from "urql";
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
import {getRewardBalances} from "./helpers/reward-helper";

const client = createClient({url: process.env.NEXT_PUBLIC_API});

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

    await this.refreshPairs()
    this.setStore({veToken: await this._getVeTokenBase()});
    this.setStore({baseAssets: await getBaseAssets()});
    this.setStore({routeAssets: ROUTE_ASSETS});
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

  _updateVestNFTByID = async (id) => {
    this.setStore({vestNFTs: await updateVestNFTByID(id, this.getStore("vestNFTs"), this.getWeb3(), this.getStore("govToken"))});
    this.emitter.emit(ACTIONS.UPDATED);
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

  refreshPairs = async () => {
    this.setStore({pairs: await getPairs()});
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

  // todo remove
  updatePairsCall = async (web3, account) => {
    try {
      const response = await client.query(QUERIES.pairsQuery).toPromise();
      const pairsCall = response;
      this.setStore({pairs: pairsCall.data.pairs});

      await this._getPairInfo(web3, account, pairsCall.data.pairs);
    } catch (ex) {
      console.log(ex);
    }
  };

  //todo remove
  getTXUUID = () => {
    return uuidv4();
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
    try {
      const account = stores.accountStore.getStore("account");
      if (!account) {
        console.warn("account not found");
        return null;
      }

      const web3 = await stores.accountStore.getWeb3Provider();
      if (!web3) {
        console.warn("web3 not found");
        return null;
      }

      const {pair, tokenID} = payload.content;

      // ADD TRNASCTIONS TO TRANSACTION QUEUE DISPLAY
      let claimTXID = this.getTXUUID();

      this.emitter.emit(ACTIONS.TX_ADDED, {
        title: `Claim rewards for ${pair.token0.symbol}/${pair.token1.symbol}`,
        verb: "Rewards Claimed",
        transactions: [
          {
            uuid: claimTXID,
            description: `Claiming your bribes`,
            status: "WAITING",
          },
        ],
      });

      const gasPrice = await stores.accountStore.getGasPrice();

      // SUBMIT CLAIM TRANSACTION
      const gaugesContract = new web3.eth.Contract(
        CONTRACTS.VOTER_ABI,
        CONTRACTS.VOTER_ADDRESS
      );

      const sendGauges = [pair.gauge.bribeAddress];
      const sendTokens = [
        pair.gauge.bribesEarned.map((bribe) => {
          return bribe.address;
        }),
      ];

      this._callContractWait(
        web3,
        gaugesContract,
        "claimBribes",
        [sendGauges, sendTokens, tokenID],
        account,
        gasPrice,
        null,
        null,
        claimTXID,
        async (err) => {
          if (err) {
            return this.emitter.emit(ACTIONS.ERROR, err);
          }

          this.getRewardBalances({content: {tokenID}});
          this.emitter.emit(ACTIONS.CLAIM_REWARD_RETURNED);
        }
      );
    } catch (ex) {
      console.error(ex);
      this.emitter.emit(ACTIONS.ERROR, ex);
    }
  };

  claimAllRewards = async (payload) => {
    try {
      const context = this;
      const account = stores.accountStore.getStore("account");
      if (!account) {
        console.warn("account not found");
        return null;
      }

      const web3 = await stores.accountStore.getWeb3Provider();
      if (!web3) {
        console.warn("web3 not found");
        return null;
      }

      const {pairs, tokenID} = payload.content;

      // ADD TRNASCTIONS TO TRANSACTION QUEUE DISPLAY
      let claimTXID = this.getTXUUID();
      let feeClaimTXIDs = [];
      let rewardClaimTXIDs = [];
      let distributionClaimTXIDs = [];

      let bribePairs = pairs.filter((pair) => {
        return pair.rewardType === "Bribe";
      });

      let feePairs = pairs.filter((pair) => {
        return pair.rewardType === "Fees";
      });

      let rewardPairs = pairs.filter((pair) => {
        return pair.rewardType === "Reward";
      });

      let distribution = pairs.filter((pair) => {
        return pair.rewardType === "Distribution";
      });

      const sendGauges = bribePairs.map((pair) => {
        return pair.gauge.bribeAddress;
      });
      const sendTokens = bribePairs.map((pair) => {
        return pair.gauge.bribesEarned.map((bribe) => {
          return bribe.address;
        });
      });

      if (
        bribePairs.length == 0 &&
        feePairs.length == 0 &&
        rewardPairs.length == 0
      ) {
        this.emitter.emit(ACTIONS.ERROR, "Nothing to claim");
        this.emitter.emit(ACTIONS.CLAIM_ALL_REWARDS_RETURNED);
        return;
      }

      let sendOBJ = {
        title: `Claim all rewards`,
        verb: "Rewards Claimed",
        transactions: [],
      };

      if (bribePairs.length > 0) {
        sendOBJ.transactions.push({
          uuid: claimTXID,
          description: `Claiming all your available bribes`,
          status: "WAITING",
        });
      }

      if (feePairs.length > 0) {
        for (let i = 0; i < feePairs.length; i++) {
          const newClaimTX = this.getTXUUID();

          feeClaimTXIDs.push(newClaimTX);
          sendOBJ.transactions.push({
            uuid: newClaimTX,
            description: `Claiming fees for ${feePairs[i].symbol}`,
            status: "WAITING",
          });
        }
      }

      if (rewardPairs.length > 0) {
        for (let i = 0; i < rewardPairs.length; i++) {
          const newClaimTX = this.getTXUUID();

          rewardClaimTXIDs.push(newClaimTX);
          sendOBJ.transactions.push({
            uuid: newClaimTX,
            description: `Claiming reward for ${rewardPairs[i].symbol}`,
            status: "WAITING",
          });
        }
      }

      if (distribution.length > 0) {
        for (let i = 0; i < distribution.length; i++) {
          const newClaimTX = this.getTXUUID();

          distributionClaimTXIDs.push(newClaimTX);
          sendOBJ.transactions.push({
            uuid: newClaimTX,
            description: `Claiming distribution for NFT #${distribution[i].token.id}`,
            status: "WAITING",
          });
        }
      }

      this.emitter.emit(ACTIONS.TX_ADDED, sendOBJ);

      const gasPrice = await stores.accountStore.getGasPrice();

      if (bribePairs.length > 0) {
        // SUBMIT CLAIM TRANSACTION
        const gaugesContract = new web3.eth.Contract(
          CONTRACTS.VOTER_ABI,
          CONTRACTS.VOTER_ADDRESS
        );

        const claimPromise = new Promise((resolve, reject) => {
          context._callContractWait(
            web3,
            gaugesContract,
            "claimBribes",
            [sendGauges, sendTokens, tokenID],
            account,
            gasPrice,
            null,
            null,
            claimTXID,
            (err) => {
              if (err) {
                reject(err);
                return;
              }

              resolve();
            }
          );
        });

        await Promise.all([claimPromise]);
      }

      if (feePairs.length > 0) {
        for (let i = 0; i < feePairs.length; i++) {
          const pairContract = new web3.eth.Contract(
            CONTRACTS.PAIR_ABI,
            feePairs[i].address
          );

          const claimPromise = new Promise((resolve, reject) => {
            context._callContractWait(
              web3,
              pairContract,
              "claimFees",
              [],
              account,
              gasPrice,
              null,
              null,
              feeClaimTXIDs[i],
              (err) => {
                if (err) {
                  reject(err);
                  return;
                }

                resolve();
              }
            );
          });

          await Promise.all([claimPromise]);
        }
      }

      if (rewardPairs.length > 0) {
        for (let i = 0; i < rewardPairs.length; i++) {
          const gaugeContract = new web3.eth.Contract(
            CONTRACTS.GAUGE_ABI,
            rewardPairs[i].gauge.address
          );
          const sendTok = [CONTRACTS.GOV_TOKEN_ADDRESS];

          const rewardPromise = new Promise((resolve, reject) => {
            context._callContractWait(
              web3,
              gaugeContract,
              "getReward",
              [account.address, sendTok],
              account,
              gasPrice,
              null,
              null,
              rewardClaimTXIDs[i],
              (err) => {
                if (err) {
                  reject(err);
                  return;
                }

                resolve();
              }
            );
          });

          await Promise.all([rewardPromise]);
        }
      }

      if (distribution.length > 0) {
        const veDistContract = new web3.eth.Contract(
          CONTRACTS.VE_DIST_ABI,
          CONTRACTS.VE_DIST_ADDRESS
        );
        for (let i = 0; i < distribution.length; i++) {
          const rewardPromise = new Promise((resolve, reject) => {
            context._callContractWait(
              web3,
              veDistContract,
              "claim",
              [tokenID],
              account,
              gasPrice,
              null,
              null,
              distributionClaimTXIDs[i],
              (err) => {
                if (err) {
                  reject(err);
                  return;
                }

                resolve();
              }
            );
          });

          await Promise.all([rewardPromise]);
        }
      }

      this.getRewardBalances({content: {tokenID}});
      this.emitter.emit(ACTIONS.CLAIM_ALL_REWARDS_RETURNED);
    } catch (ex) {
      console.error(ex);
      this.emitter.emit(ACTIONS.ERROR, ex);
    }
  };

  claimRewards = async (payload) => {
    try {
      const account = stores.accountStore.getStore("account");
      if (!account) {
        console.warn("account not found");
        return null;
      }

      const web3 = await stores.accountStore.getWeb3Provider();
      if (!web3) {
        console.warn("web3 not found");
        return null;
      }

      const {pair, tokenID} = payload.content;

      // ADD TRNASCTIONS TO TRANSACTION QUEUE DISPLAY
      let claimTXID = this.getTXUUID();

      this.emitter.emit(ACTIONS.TX_ADDED, {
        title: `Claim rewards for ${pair.token0.symbol}/${pair.token1.symbol}`,
        verb: "Rewards Claimed",
        transactions: [
          {
            uuid: claimTXID,
            description: `Claiming your rewards`,
            status: "WAITING",
          },
        ],
      });

      const gasPrice = await stores.accountStore.getGasPrice();

      // SUBMIT CLAIM TRANSACTION
      const gaugeContract = new web3.eth.Contract(
        CONTRACTS.GAUGE_ABI,
        pair.gauge.address
      );

      const sendTokens = [CONTRACTS.GOV_TOKEN_ADDRESS];

      this._callContractWait(
        web3,
        gaugeContract,
        "getReward",
        [account.address, sendTokens],
        account,
        gasPrice,
        null,
        null,
        claimTXID,
        async (err) => {
          if (err) {
            return this.emitter.emit(ACTIONS.ERROR, err);
          }

          this.getRewardBalances({content: {tokenID}});
          this.emitter.emit(ACTIONS.CLAIM_REWARD_RETURNED);
        }
      );
    } catch (ex) {
      console.error(ex);
      this.emitter.emit(ACTIONS.ERROR, ex);
    }
  };

  claimVeDist = async (payload) => {
    try {
      const account = stores.accountStore.getStore("account");
      if (!account) {
        console.warn("account not found");
        return null;
      }

      const web3 = await stores.accountStore.getWeb3Provider();
      if (!web3) {
        console.warn("web3 not found");
        return null;
      }

      const {tokenID} = payload.content;

      // ADD TRNASCTIONS TO TRANSACTION QUEUE DISPLAY
      let claimTXID = this.getTXUUID();

      this.emitter.emit(ACTIONS.TX_ADDED, {
        title: `Claim distribution for NFT #${tokenID}`,
        verb: "Rewards Claimed",
        transactions: [
          {
            uuid: claimTXID,
            description: `Claiming your distribution`,
            status: "WAITING",
          },
        ],
      });

      const gasPrice = await stores.accountStore.getGasPrice();

      // SUBMIT CLAIM TRANSACTION
      const veDistContract = new web3.eth.Contract(
        CONTRACTS.VE_DIST_ABI,
        CONTRACTS.VE_DIST_ADDRESS
      );

      this._callContractWait(
        web3,
        veDistContract,
        "claim",
        [tokenID],
        account,
        gasPrice,
        null,
        null,
        claimTXID,
        async (err) => {
          if (err) {
            return this.emitter.emit(ACTIONS.ERROR, err);
          }

          this.getRewardBalances({content: {tokenID}});
          this.emitter.emit(ACTIONS.CLAIM_VE_DIST_RETURNED);
        }
      );
    } catch (ex) {
      console.error(ex);
      this.emitter.emit(ACTIONS.ERROR, ex);
    }
  };

  claimPairFees = async (payload) => {
    try {
      const account = stores.accountStore.getStore("account");
      if (!account) {
        console.warn("account not found");
        return null;
      }

      const web3 = await stores.accountStore.getWeb3Provider();
      if (!web3) {
        console.warn("web3 not found");
        return null;
      }

      const {pair, tokenID} = payload.content;

      // ADD TRNASCTIONS TO TRANSACTION QUEUE DISPLAY
      let claimTXID = this.getTXUUID();

      this.emitter.emit(ACTIONS.TX_ADDED, {
        title: `Claim fees for ${pair.token0.symbol}/${pair.token1.symbol}`,
        verb: "Fees Claimed",
        transactions: [
          {
            uuid: claimTXID,
            description: `Claiming your fees`,
            status: "WAITING",
          },
        ],
      });

      const gasPrice = await stores.accountStore.getGasPrice();

      // SUBMIT CLAIM TRANSACTION
      const pairContract = new web3.eth.Contract(
        CONTRACTS.PAIR_ABI,
        pair.address
      );

      this._callContractWait(
        web3,
        pairContract,
        "claimFees",
        [],
        account,
        gasPrice,
        null,
        null,
        claimTXID,
        async (err) => {
          if (err) {
            return this.emitter.emit(ACTIONS.ERROR, err);
          }

          this.getRewardBalances({content: {tokenID}});
          this.emitter.emit(ACTIONS.CLAIM_REWARD_RETURNED);
        }
      );
    } catch (ex) {
      console.error(ex);
      this.emitter.emit(ACTIONS.ERROR, ex);
    }
  };

  searchWhitelist = async (payload) => {
    try {
      const account = stores.accountStore.getStore("account");
      if (!account) {
        console.warn("account not found");
        return null;
      }

      const web3 = await stores.accountStore.getWeb3Provider();
      if (!web3) {
        console.warn("web3 not found");
        return null;
      }
      const veToken = this.getStore("veToken");

      const {search} = payload.content;

      const voterContract = new web3.eth.Contract(
        CONTRACTS.VOTER_ABI,
        CONTRACTS.VOTER_ADDRESS
      );

      const [isWhitelisted, listingFee] = await Promise.all([
        voterContract.methods.isWhitelisted(search).call(),
        voterContract.methods.listingFee().call(),
      ]);

      const token = await this.getBaseAsset(search);
      token.isWhitelisted = isWhitelisted;
      token.listingFee = BigNumber(listingFee)
        .div(10 ** 18)
        .toFixed(18);

      this.emitter.emit(ACTIONS.SEARCH_WHITELIST_RETURNED, token);
    } catch (ex) {
      console.error(ex);
      this.emitter.emit(ACTIONS.ERROR, ex);
    }
  };

  whitelistToken = async (payload) => {
    try {
      const account = stores.accountStore.getStore("account");
      if (!account) {
        console.warn("account not found");
        return null;
      }

      const web3 = await stores.accountStore.getWeb3Provider();
      if (!web3) {
        console.warn("web3 not found");
        return null;
      }

      const {token, nft} = payload.content;

      // ADD TRNASCTIONS TO TRANSACTION QUEUE DISPLAY
      let whitelistTXID = this.getTXUUID();

      this.emitter.emit(ACTIONS.TX_ADDED, {
        title: `WHITELIST ${token.symbol}`,
        verb: "Token Whitelisted",
        transactions: [
          {
            uuid: whitelistTXID,
            description: `Whitelisting ${token.symbol}`,
            status: "WAITING",
          },
        ],
      });

      const gasPrice = await stores.accountStore.getGasPrice();

      // SUBMIT WHITELIST TRANSACTION
      const voterContract = new web3.eth.Contract(
        CONTRACTS.VOTER_ABI,
        CONTRACTS.VOTER_ADDRESS
      );

      this._callContractWait(
        web3,
        voterContract,
        "whitelist",
        [token.address, nft.id],
        account,
        gasPrice,
        null,
        null,
        whitelistTXID,
        async (err) => {
          if (err) {
            return this.emitter.emit(ACTIONS.ERROR, err);
          }

          window.setTimeout(() => {
            this.dispatcher.dispatch({
              type: ACTIONS.SEARCH_WHITELIST,
              content: {search: token.address},
            });
          }, 2);

          this.emitter.emit(ACTIONS.WHITELIST_TOKEN_RETURNED);
        }
      );
    } catch (ex) {
      console.error(ex);
      this.emitter.emit(ACTIONS.ERROR, ex);
    }
  };

  _callContractWait = (
    web3,
    contract,
    method,
    params,
    account,
    gasPrice,
    dispatchEvent,
    dispatchContent,
    uuid,
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
    this.emitter.emit(ACTIONS.TX_PENDING, {uuid});

    const gasCost = contract.methods[method](...params)
      .estimateGas({from: account.address, value: sendValue})
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
            from: account.address,
            gasPrice: web3.utils.toWei(sendGasPrice, "gwei"),
            gas: sendGasAmount,
            value: sendValue,
            // maxFeePerGas: web3.utils.toWei(gasPrice, "gwei"),
            // maxPriorityFeePerGas: web3.utils.toWei("2", "gwei"),
          })
          .on("transactionHash", function (txHash) {
            context.emitter.emit(ACTIONS.TX_SUBMITTED, {uuid, txHash});
          })
          .on("receipt", function (receipt) {
            context.emitter.emit(ACTIONS.TX_CONFIRMED, {
              uuid,
              txHash: receipt.transactionHash,
            });
            callback(null, receipt.transactionHash);
            if (dispatchEvent) {
              context.dispatcher.dispatch({
                type: dispatchEvent,
                content: dispatchContent,
              });
            }
          })
          .on("error", function (error) {
            if (!error.toString().includes("-32601")) {
              if (error.message) {
                context.emitter.emit(ACTIONS.TX_REJECTED, {
                  uuid,
                  error: error.message,
                });
                return callback(error.message);
              }
              context.emitter.emit(ACTIONS.TX_REJECTED, {uuid, error: error});
              callback(error);
            }
          })
          .catch((error) => {
            if (!error.toString().includes("-32601")) {
              if (error.message) {
                context.emitter.emit(ACTIONS.TX_REJECTED, {
                  uuid,
                  error: error.message,
                });
                return callback(error.message);
              }
              context.emitter.emit(ACTIONS.TX_REJECTED, {uuid, error: error});
              callback(error);
            }
          });
      })
      .catch((ex) => {
        console.log(ex);
        if (ex.message) {
          this.emitter.emit(ACTIONS.TX_REJECTED, {uuid, error: ex.message});
          return callback(ex.message);
        }
        this.emitter.emit(ACTIONS.TX_REJECTED, {
          uuid,
          error: "Error estimating gas",
        });
        callback(ex);
      });
  };
}

export default Store;
