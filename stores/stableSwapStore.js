import {ACTIONS, CONTRACTS, MAX_UINT256, QUERIES, ROUTE_ASSETS} from "./constants";
import {v4 as uuidv4} from "uuid";

import * as moment from "moment";
import {buildRoutes, formatBN, formatCurrency, getAmountOut, getPrice, removeDuplicate, retry} from "../utils";
import stores from "./";

import BigNumber from "bignumber.js";
import {createClient} from "urql";
import router from "next/router";
import {getNftById, getVeApr, loadNfts, updateVestNFTByID} from "./helpers/ve-helper";
import {enrichPairInfo, getAndUpdatePair, getPairs, loadPair} from "./helpers/pair-helper";
import {removeBaseAsset, saveLocalAsset} from "./helpers/local-storage-helper";
import {
  enrichBaseAssetInfo,
  getBaseAssets,
  getLiquidityBalances,
  getOrCreateBaseAsset,
  getTokenBalance
} from "./helpers/token-helper";
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
import {createVest} from "./helpers/vest-helper";

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
            this.getBalances(payload);
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
    this.setStore({baseAssets: await this._getBaseAssets()});
    this.setStore({pairs: await this._getPairs()});
    this.setStore({routeAssets: ROUTE_ASSETS});

    this.emitter.emit(ACTIONS.UPDATED);
    this.emitter.emit(ACTIONS.CONFIGURED_SS);

    setTimeout(() => {
      this.dispatcher.dispatch({type: ACTIONS.GET_BALANCES});
    }, 1);
  };

  getStore = (index) => {
    return this.store[index];
  };

  setStore = (obj) => {
    this.store = {...this.store, ...obj};
    return this.emitter.emit(ACTIONS.STORE_UPDATED);
  };

  // COMMON GETTER FUNCTIONS Assets, BaseAssets, Pairs etc
  getAsset = (address) => {
    return this.store.baseAssets.filter(a => a?.address?.toLowerCase() === address?.toLowerCase()).reduce((a, b) => b, null);
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
    const nfts = await loadNfts(this.getAccount(), await this.getWeb3(), this.getStore("govToken"));
    this.setStore({vestNFTs: nfts});
    return getNftById(id, nfts);
  };

  getVestNFTs = async () => {
    const nfts = await loadNfts();
    this.setStore({vestNFTs: nfts});
    this.emitter.emit(ACTIONS.VEST_NFTS_RETURNED, nfts);
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

  _getBaseAssets = async () => {
    return await getBaseAssets();
  };

  _getPairs = async () => {
    const pairs = await getPairs();
    return !pairs ? [] : pairs;
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
      await this._getGovTokenInfo(await this.getWeb3(), this.getAccount());
      await this._getBaseAssetInfo(await this.getWeb3(), this.getAccount());
      await this._getPairInfo(await this.getWeb3(), this.getAccount());
    } catch (ex) {
      console.log("Get balances fail", ex);
      this.emitter.emit(ACTIONS.ERROR, ex);
    }
  };

  _getGovTokenInfo = async (web3, account) => {
    try {
      const govToken = this.getStore("govToken");
      govToken.balanceOf = await getTokenBalance(govToken.address, web3, account.address, govToken.decimals);
      govToken.balance = formatBN(govToken.balanceOf, govToken.decimals)
      this.setStore({govToken});
      // get ve balance
      const nfts = await loadNfts(account, web3, this.getStore("govToken"));
      this.setStore({vestNFTs: nfts});
      this.emitter.emit(ACTIONS.UPDATED);
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
    await enrichBaseAssetInfo(web3, account, baseAssets, await stores.accountStore.getMulticall())
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
      async () => await this._getPairs()
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
      async () => await this._getPairs()
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
      async () => await this._getPairs()
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
      async () => await this._getPairs()
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
      async () => await this._getPairs()
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
      async () => await this._getPairs()
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
        await this._getGovTokenInfo(web3, account);
        await this.getNFTByID("fetchAll");
      }
    )
  };

  _getVestAllowance = async (web3, token, account) => {
    try {
      const tokenContract = new web3.eth.Contract(
        CONTRACTS.ERC20_ABI,
        token.address
      );
      const allowance = await tokenContract.methods
        .allowance(account.address, CONTRACTS.VE_TOKEN_ADDRESS)
        .call();
      return BigNumber(allowance)
        .div(10 ** parseInt(token.decimals))
        .toFixed(parseInt(token.decimals));
    } catch (ex) {
      console.error(ex);
      return null;
    }
  };

  increaseVestAmount = async (payload) => {
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

      const govToken = this.getStore("govToken");
      const {amount, tokenID} = payload.content;

      // ADD TRNASCTIONS TO TRANSACTION QUEUE DISPLAY
      let allowanceTXID = this.getTXUUID();
      let vestTXID = this.getTXUUID();

      this.emitter.emit(ACTIONS.TX_ADDED, {
        title: `Increase vest amount on token #${tokenID}`,
        type: "Vest",
        verb: "Vest Increased",
        transactions: [
          {
            uuid: allowanceTXID,
            description: `Checking your ${govToken.symbol} allowance`,
            status: "WAITING",
          },
          {
            uuid: vestTXID,
            description: `Increasing your vest amount`,
            status: "WAITING",
          },
        ],
      });

      // CHECK ALLOWANCES AND SET TX DISPLAY
      const allowance = await this._getVestAllowance(web3, govToken, account);

      if (BigNumber(allowance).lt(amount)) {
        this.emitter.emit(ACTIONS.TX_STATUS, {
          uuid: allowanceTXID,
          description: `Allow vesting contract to use your ${govToken.symbol}`,
        });
      } else {
        this.emitter.emit(ACTIONS.TX_STATUS, {
          uuid: allowanceTXID,
          description: `Allowance on ${govToken.symbol} sufficient`,
          status: "DONE",
        });
      }

      const gasPrice = await stores.accountStore.getGasPrice();

      const allowanceCallsPromises = [];

      // SUBMIT REQUIRED ALLOWANCE TRANSACTIONS
      if (BigNumber(allowance).lt(amount)) {
        const tokenContract = new web3.eth.Contract(
          CONTRACTS.ERC20_ABI,
          govToken.address
        );

        const tokenPromise = new Promise((resolve, reject) => {
          this._callContractWait(
            web3,
            tokenContract,
            "approve",
            [CONTRACTS.VE_TOKEN_ADDRESS, MAX_UINT256],
            account,
            gasPrice,
            null,
            null,
            allowanceTXID,
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

      const done = await Promise.all(allowanceCallsPromises);

      // SUBMIT INCREASE TRANSACTION
      const sendAmount = BigNumber(amount)
        .times(10 ** govToken.decimals)
        .toFixed(0);

      const veTokenContract = new web3.eth.Contract(
        CONTRACTS.VE_TOKEN_ABI,
        CONTRACTS.VE_TOKEN_ADDRESS
      );

      this._callContractWait(
        web3,
        veTokenContract,
        "increaseAmount",
        [tokenID, sendAmount],
        account,
        gasPrice,
        null,
        null,
        vestTXID,
        (err) => {
          if (err) {
            return this.emitter.emit(ACTIONS.ERROR, err);
          }

          this._getGovTokenInfo(web3, account);
          this._updateVestNFTByID(tokenID);

          this.emitter.emit(ACTIONS.INCREASE_VEST_AMOUNT_RETURNED);
        }
      );
    } catch (ex) {
      console.error(ex);
      this.emitter.emit(ACTIONS.ERROR, ex);
    }
  };

  increaseVestDuration = async (payload) => {
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

      const govToken = this.getStore("govToken");
      const {tokenID, unlockTime} = payload.content;

      // ADD TRNASCTIONS TO TRANSACTION QUEUE DISPLAY
      let vestTXID = this.getTXUUID();

      this.emitter.emit(ACTIONS.TX_ADDED, {
        title: `Increase unlock time on token #${tokenID}`,
        type: "Vest",
        verb: "Vest Increased",
        transactions: [
          {
            uuid: vestTXID,
            description: `Increasing your vest duration`,
            status: "WAITING",
          },
        ],
      });

      const gasPrice = await stores.accountStore.getGasPrice();

      // SUBMIT INCREASE TRANSACTION
      const veTokenContract = new web3.eth.Contract(
        CONTRACTS.VE_TOKEN_ABI,
        CONTRACTS.VE_TOKEN_ADDRESS
      );

      this._callContractWait(
        web3,
        veTokenContract,
        "increaseUnlockTime",
        [tokenID, unlockTime + ""],
        account,
        gasPrice,
        null,
        null,
        vestTXID,
        (err) => {
          if (err) {
            return this.emitter.emit(ACTIONS.ERROR, err);
          }

          this._updateVestNFTByID(tokenID);

          this.emitter.emit(ACTIONS.INCREASE_VEST_DURATION_RETURNED);
        }
      );
    } catch (ex) {
      console.error(ex);
      this.emitter.emit(ACTIONS.ERROR, ex);
    }
  };

  withdrawVest = async (payload) => {
    try {
      const {tokenID} = payload.content;

      const veGaugesQueryResponse = (await client.query(QUERIES.veQuery, {id: tokenID}).toPromise());
      // console.log('VE GAUGES', veGaugesQueryResponse)
      if (!!veGaugesQueryResponse.error) {
        console.log("VE GAUGES QUERY ERROR", veGaugesQueryResponse.error);
      }

      const gauges = veGaugesQueryResponse.data.veNFTEntities[0].gauges;
      const bribes = veGaugesQueryResponse.data.veNFTEntities[0].bribes;
      let gaugesLength = gauges.length;
      let bribesLength = bribes.length;

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

      const govToken = this.getStore("govToken");
      // ADD TRNASCTIONS TO TRANSACTION QUEUE DISPLAY
      let vestTXID = this.getTXUUID();

      let withdrawAllTXID = [];
      let arrTx = [];
      if (gaugesLength != 0 || gaugesLength != null || gaugesLength != "") {
        for (var i = 0; i < gaugesLength; i++) {
          withdrawAllTXID[i] = this.getTXUUID();
          let a = {
            uuid: withdrawAllTXID[i],
            description: `Withdrawing your tokens for gauge `,
            status: "WAITING",
          };
          arrTx.push(a);
        }
      }
      let voteTXID = this.getTXUUID();

      let c = {
        uuid: vestTXID,
        description: `Withdrawing your expired tokens`,
        status: "WAITING",
      };
      arrTx.push(c);

      this.emitter.emit(ACTIONS.TX_ADDED, {
        title: `Withdraw vest amount on token #${tokenID}`,
        type: "Vest",
        verb: "Vest Withdrawn",
        transactions: arrTx,
      });

      const gasPrice = await stores.accountStore.getGasPrice();

      // SUBMIT INCREASE TRANSACTION
      const veTokenContract = new web3.eth.Contract(
        CONTRACTS.VE_TOKEN_ABI,
        CONTRACTS.VE_TOKEN_ADDRESS
      );
      let allowanceCallsPromise = [];
      if (gaugesLength !== 0) {
        for (var i = 0; i < gaugesLength; i++) {
          let gaugeContract = new web3.eth.Contract(
            CONTRACTS.GAUGE_ABI,
            gauges[i].gauge.id
          );
          const withdrawAll = new Promise((resolve, reject) => {
            this._callContractWait(
              web3,
              gaugeContract,
              "withdrawAll",
              [],
              account,
              gasPrice,
              null,
              null,
              withdrawAllTXID[i],
              (err) => {
                if (err) {
                  reject(err);
                  return;
                }

                resolve();
              }
            );
          });

          allowanceCallsPromise.push(withdrawAll);

          const done = await Promise.all(allowanceCallsPromise);
        }
      }


      // SUBMIT INCREASE TRANSACTION
      if (bribesLength !== 0) {
        let b = {
          uuid: voteTXID,
          description: `Reset votes`,
          status: "WAITING",
        };
        arrTx.push(b);

        const voterContract = new web3.eth.Contract(
          CONTRACTS.VOTER_ABI,
          CONTRACTS.VOTER_ADDRESS
        );

        const reset = new Promise((resolve, reject) => {
          this._callContractWait(
            web3,
            voterContract,
            "reset",
            [tokenID],
            account,
            gasPrice,
            null,
            null,
            voteTXID,
            (err) => {
              if (err) {
                reject(err);
                return;
              }

              resolve();
            }
          );
        });

        allowanceCallsPromise.push(reset);
        await Promise.all(allowanceCallsPromise);
      }

      const withdraw = new Promise((resolve, reject) => {
        this._callContractWait(
          web3,
          veTokenContract,
          "withdraw",
          [tokenID],
          account,
          gasPrice,
          null,
          null,
          vestTXID,
          (err) => {
            if (err) {
              reject(err);
              return;
            }
            this._updateVestNFTByID(tokenID);

            this.emitter.emit(ACTIONS.WITHDRAW_VEST_RETURNED);
            resolve();
          }
        );
      });
    } catch (ex) {
      console.error(ex);
      this.emitter.emit(ACTIONS.ERROR, ex);
    }
  };

  merge = async (payload) => {
    try {
      const {tokenIDOne, tokenIDTwo} = payload.content;

      const veGaugesQueryResponse = (await client.query(QUERIES.veQuery, {id: tokenIDOne.id}).toPromise());
      // console.log('VE GAUGES', veGaugesQueryResponse)
      if (!!veGaugesQueryResponse.error) {
        console.log("VE GAUGES QUERY ERROR", veGaugesQueryResponse.error);
      }

      const gauges = veGaugesQueryResponse.data.veNFTEntities[0].gauges;
      const bribes = veGaugesQueryResponse.data.veNFTEntities[0].bribes;
      let gaugesLength = gauges.length;
      let bribesLength = bribes.length;


      let allowanceCallsPromise = [];
      let voteResetTXID = this.getTXUUID();
      let allowanceTXID = this.getTXUUID();
      let mergeTXID = this.getTXUUID();

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

      const vedystcontract = new web3.eth.Contract(
        CONTRACTS.VE_TOKEN_ABI,
        CONTRACTS.VE_TOKEN_ADDRESS
      );

      let withdrawAllTXID = [];
      let arrTx = [];
      let c = {
        uuid: allowanceTXID,
        description: `Checking Allowance for veDYST to Merge`,
        status: "WAITING",
      };
      arrTx.push(c);

      if (gaugesLength !== 0) {
        for (var i = 0; i < gaugesLength; i++) {
          withdrawAllTXID[i] = this.getTXUUID();
          let a = {
            uuid: withdrawAllTXID[i],
            description: `Withdrawing your tokens for gauge `,
            status: "WAITING",
          };
          arrTx.push(a);
        }
      }

      if (bribesLength !== 0) {
        let b = {
          uuid: voteResetTXID,
          description: `Reset votes`,
          status: "WAITING",
        };
        arrTx.push(b);
      }

      let d = {
        uuid: mergeTXID,
        description: `Merge veDYST`,
        status: "WAITING",
      };
      arrTx.push(d);

      this.emitter.emit(ACTIONS.TX_ADDED, {
        title: `Withdraw vest amount on token #${tokenIDOne.id}`,
        type: "Vest",
        verb: "Vest Withdrawn",
        transactions: arrTx,
      });

      let isApproved = await vedystcontract.methods
        .isApprovedForAll(account.address, CONTRACTS.VE_TOKEN_ADDRESS)
        .call();

      if (!isApproved) {
        this.emitter.emit(ACTIONS.TX_STATUS, {
          uuid: allowanceTXID,
          description: `Allow the veDYST For Merge`,
        });
      } else {
        this.emitter.emit(ACTIONS.TX_STATUS, {
          uuid: allowanceTXID,
          description: `Allowance on veDYST sufficient`,
          status: "DONE",
        });
      }
      if (bribesLength !== 0) {
        this.emitter.emit(ACTIONS.TX_STATUS, {
          uuid: voteResetTXID,
          description: `Reset the veDYST Votes`,
        });
      } else {
        this.emitter.emit(ACTIONS.TX_STATUS, {
          uuid: voteResetTXID,
          description: `Votes Reseted`,
          status: "DONE",
        });
      }

      const gasPrice = await stores.accountStore.getGasPrice();
      if (!isApproved) {
        const approve = new Promise((resolve, reject) => {
          this._callContractWait(
            web3,
            vedystcontract,
            "setApprovalForAll",
            [CONTRACTS.VE_TOKEN_ADDRESS, "true"],
            account,
            gasPrice,
            null,
            null,
            allowanceTXID,
            (err) => {
              if (err) {
                reject(err);
                return;
              }

              resolve();
            }
          );
        });

        allowanceCallsPromise.push(approve);
        await Promise.all(allowanceCallsPromise);
      }
      if (gaugesLength !== 0) {
        for (var i = 0; i < gaugesLength; i++) {
          let gaugeContract = new web3.eth.Contract(
            CONTRACTS.GAUGE_ABI,
            gauges[i].gauge.id
          );
          const withdrawAll = new Promise((resolve, reject) => {
            this._callContractWait(
              web3,
              gaugeContract,
              "withdrawAll",
              [],
              account,
              gasPrice,
              null,
              null,
              withdrawAllTXID[i],
              (err) => {
                if (err) {
                  reject(err);
                  return;
                }

                resolve();
              }
            );
          });

          allowanceCallsPromise.push(withdrawAll);

          const done = await Promise.all(allowanceCallsPromise);
        }
      }

      // SUBMIT INCREASE TRANSACTION
      const voterContract = new web3.eth.Contract(
        CONTRACTS.VOTER_ABI,
        CONTRACTS.VOTER_ADDRESS
      );

      if (bribesLength > 0) {
        const reset = new Promise((resolve, reject) => {
          this._callContractWait(
            web3,
            voterContract,
            "reset",
            [tokenIDOne.id],
            account,
            gasPrice,
            null,
            null,
            voteResetTXID,
            (err) => {
              if (err) {
                reject(err);
                return;
              }

              resolve();
            }
          );
        });

        allowanceCallsPromise.push(reset);
        await Promise.all(allowanceCallsPromise);
      }
      const merge = new Promise((resolve, reject) => {
        this._callContractWait(
          web3,
          vedystcontract,
          "merge",
          [tokenIDOne.id, tokenIDTwo.id],
          account,
          gasPrice,
          null,
          null,
          mergeTXID,
          (err) => {
            if (err) {
              reject(err);
              return;
            }

            resolve();
          }
        );
      });

      allowanceCallsPromise.push(merge);
      await Promise.all(allowanceCallsPromise);
      router.push("/vest");
    } catch (ex) {
      console.error(ex);
      this.emitter.emit(ACTIONS.ERROR, ex);
    }
  };

  vote = async (payload) => {
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

      const govToken = this.getStore("govToken");
      const {tokenID, votes} = payload.content;

      // ADD TRNASCTIONS TO TRANSACTION QUEUE DISPLAY
      let voteTXID = this.getTXUUID();

      this.emitter.emit(ACTIONS.TX_ADDED, {
        title: `Cast vote using token #${tokenID}`,
        verb: "Votes Cast",
        transactions: [
          {
            uuid: voteTXID,
            description: `Cast votes`,
            status: "WAITING",
          },
        ],
      });

      const gasPrice = await stores.accountStore.getGasPrice();

      // SUBMIT INCREASE TRANSACTION
      const gaugesContract = new web3.eth.Contract(
        CONTRACTS.VOTER_ABI,
        CONTRACTS.VOTER_ADDRESS
      );

      let onlyVotes = votes.filter((vote) => {
        return BigNumber(vote.value).gt(0) || BigNumber(vote.value).lt(0);
      });

      let tokens = onlyVotes.map((vote) => {
        return vote.address;
      });

      let voteCounts = onlyVotes.map((vote) => {
        return BigNumber(vote.value).times(100).toFixed(0);
      });

      this._callContractWait(
        web3,
        gaugesContract,
        "vote",
        [tokenID, tokens, voteCounts],
        account,
        gasPrice,
        null,
        null,
        voteTXID,
        (err) => {
          if (err) {
            return this.emitter.emit(ACTIONS.ERROR, err);
          }

          this.emitter.emit(ACTIONS.VOTE_RETURNED);
        }
      );
    } catch (ex) {
      console.error(ex);
      this.emitter.emit(ACTIONS.ERROR, ex);
    }
  };

  resetVote = async (payload) => {
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
      let voteTXID = this.getTXUUID();

      this.emitter.emit(ACTIONS.TX_ADDED, {
        title: `Reset vote using token #${tokenID}`,
        verb: "Reset Votes",
        transactions: [
          {
            uuid: voteTXID,
            description: `Reset votes`,
            status: "WAITING",
          },
        ],
      });

      const gasPrice = await stores.accountStore.getGasPrice();

      // SUBMIT INCREASE TRANSACTION
      const gaugesContract = new web3.eth.Contract(
        CONTRACTS.VOTER_ABI,
        CONTRACTS.VOTER_ADDRESS
      );

      this._callContractWait(
        web3,
        gaugesContract,
        "reset",
        [tokenID],
        account,
        gasPrice,
        null,
        null,
        voteTXID,
        (err) => {
          if (err) {
            return this.emitter.emit(ACTIONS.ERROR, err);
          }

          this.emitter.emit(ACTIONS.VOTE_RETURNED);
        }
      );
    } catch (ex) {
      console.error(ex);
      this.emitter.emit(ACTIONS.ERROR, ex);
    }
  };

  getVestVotes = async (payload) => {
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
      const pairs = this.getStore("pairs");

      if (!pairs) {
        return null;
      }

      if (!tokenID) {
        return;
      }

      const filteredPairs = pairs.filter((pair) => {
        return pair && pair.gauge && pair.gauge.address;
      });

      const gaugesContract = new web3.eth.Contract(
        CONTRACTS.VOTER_ABI,
        CONTRACTS.VOTER_ADDRESS
      );

      const multicall = await stores.accountStore.getMulticall();
      const calls = filteredPairs.map((pair) => {
        let v = gaugesContract.methods.votes(tokenID, pair.address);
        return v;
      });

      const voteCounts = await multicall.aggregate(calls);
      let votes = [];

      const totalVotes = voteCounts.reduce((curr, acc) => {
        let num = BigNumber(acc).gt(0)
          ? acc
          : BigNumber(acc).times(-1).toNumber(0);
        return BigNumber(curr).plus(num);
      }, 0);
      let t = 0;
      for (let i = 0; i < voteCounts.length; i++) {
        t = t + parseInt(voteCounts[i]);
      }

      for (let i = 0; i < voteCounts.length; i++) {
        votes.push({
          address: filteredPairs[i].address,
          votePercent:
            BigNumber(totalVotes).gt(0) || BigNumber(totalVotes).lt(0)
              ? (voteCounts[i] / t) * 100
              : "0",
        });
      }
      this.emitter.emit(ACTIONS.VEST_VOTES_RETURNED, votes);
    } catch (ex) {
      console.error(ex);
      this.emitter.emit(ACTIONS.ERROR, ex);
    }
  };

  createBribe = async (payload) => {
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

      const {asset, amount, gauge} = payload.content;

      // ADD TRNASCTIONS TO TRANSACTION QUEUE DISPLAY
      let allowanceTXID = this.getTXUUID();
      let bribeTXID = this.getTXUUID();

      this.emitter.emit(ACTIONS.TX_ADDED, {
        title: `Create bribe on ${gauge.token0.symbol}/${gauge.token1.symbol}`,
        verb: "Bribe Created",
        transactions: [
          {
            uuid: allowanceTXID,
            description: `Checking your ${asset.symbol} allowance`,
            status: "WAITING",
          },
          {
            uuid: bribeTXID,
            description: `Create bribe`,
            status: "WAITING",
          },
        ],
      });

      // CHECK ALLOWANCES AND SET TX DISPLAY
      const allowance = await this._getBribeAllowance(
        web3,
        asset,
        gauge,
        account
      );

      if (BigNumber(allowance).lt(amount)) {
        this.emitter.emit(ACTIONS.TX_STATUS, {
          uuid: allowanceTXID,
          description: `Allow the bribe contract to spend your ${asset.symbol}`,
        });
      } else {
        this.emitter.emit(ACTIONS.TX_STATUS, {
          uuid: allowanceTXID,
          description: `Allowance on ${asset.symbol} sufficient`,
          status: "DONE",
        });
      }

      const gasPrice = await stores.accountStore.getGasPrice();

      const allowanceCallsPromises = [];

      // SUBMIT REQUIRED ALLOWANCE TRANSACTIONS
      if (BigNumber(allowance).lt(amount)) {
        const tokenContract = new web3.eth.Contract(
          CONTRACTS.ERC20_ABI,
          asset.address
        );

        const tokenPromise = new Promise((resolve, reject) => {
          this._callContractWait(
            web3,
            tokenContract,
            "approve",
            [gauge.gauge.bribeAddress, MAX_UINT256],
            account,
            gasPrice,
            null,
            null,
            allowanceTXID,
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

      const done = await Promise.all(allowanceCallsPromises);

      // SUBMIT BRIBE TRANSACTION
      const bribeContract = new web3.eth.Contract(
        CONTRACTS.BRIBE_ABI,
        gauge.gauge.bribeAddress
      );

      const sendAmount = BigNumber(amount)
        .times(10 ** asset.decimals)
        .toFixed(0);

      this._callContractWait(
        web3,
        bribeContract,
        "notifyRewardAmount",
        [asset.address, sendAmount],
        account,
        gasPrice,
        null,
        null,
        bribeTXID,
        async (err) => {
          if (err) {
            return this.emitter.emit(ACTIONS.ERROR, err);
          }

          await this.updatePairsCall(web3, account);

          this.emitter.emit(ACTIONS.BRIBE_CREATED);
        }
      );
    } catch (ex) {
      console.error(ex);
      this.emitter.emit(ACTIONS.ERROR, ex);
    }
  };

  _getBribeAllowance = async (web3, token, pair, account) => {
    try {
      const tokenContract = new web3.eth.Contract(
        CONTRACTS.ERC20_ABI,
        token.address
      );
      const allowance = await tokenContract.methods
        .allowance(account.address, pair.gauge.bribeAddress)
        .call();
      return BigNumber(allowance)
        .div(10 ** parseInt(token.decimals))
        .toFixed(parseInt(token.decimals));
    } catch (ex) {
      console.error(ex);
      return null;
    }
  };

  getRewardBalances = async (payload) => {
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

      const pairs = this.getStore("pairs");
      const veToken = this.getStore("veToken");
      const govToken = this.getStore("govToken");

      const filteredPairs = [
        ...pairs.filter((pair) => {
          return pair && pair.gauge;
        }),
      ];

      const filteredPairs2 = [
        ...pairs.filter((pair) => {
          return pair && pair.gauge;
        }),
      ];

      let veDistReward = [];

      let filteredBribes = [];

      const multicall = await stores.accountStore.getMulticall();

      if (tokenID) {
        const bribesEarned = await Promise.all(
          filteredPairs.map(async (pair) => {
            const bribeContract = new web3.eth.Contract(
              CONTRACTS.BRIBE_ABI,
              pair.gauge.bribeAddress
            );
            const [rewardsListLength] = await multicall.aggregate([
              bribeContract.methods.rewardTokensLength(),
            ]);

            const bribeTokens = [
              {rewardRate: "", rewardAmount: "", address: "", symbol: ""},
            ];
            for (let i = 0; i < rewardsListLength; i++) {
              let [bribeTokenAddress] = await multicall.aggregate([
                bribeContract.methods.rewardTokens(i),
              ]);

              bribeTokens.push({
                address: bribeTokenAddress,
                rewardAmount: 0,
                rewardRate: 0,
                symbol: null,
              });
            }

            bribeTokens.shift();

            const bribesEarned = await Promise.all(
              bribeTokens.map(async (bribe) => {
                const bribeContract = new web3.eth.Contract(
                  CONTRACTS.BRIBE_ABI,
                  pair.gauge.bribeAddress
                );
                const [add] = await Promise.all([
                  bribeContract.methods.tokenIdToAddress(tokenID).call(),
                ]);
                const [earned] = await Promise.all([
                  bribeContract.methods.earned(bribe.address, add).call(),
                ]);
                const tokenContract = new web3.eth.Contract(
                  CONTRACTS.ERC20_ABI,
                  bribe.address
                );
                const [decimals, symbol] = await multicall.aggregate([
                  tokenContract.methods.decimals(),
                  tokenContract.methods.symbol(),
                ]);

                bribe.earned = BigNumber(earned)
                  .div(10 ** decimals)
                  .toFixed(parseInt(decimals));
                bribe.symbol = symbol;
                return bribe;
              })
            );

            pair.gauge.bribesEarned = bribesEarned;

            return pair;
          })
        );
        filteredBribes = bribesEarned
          .filter((pair) => {
            if (
              pair.gauge &&
              pair.gauge.bribesEarned &&
              pair.gauge.bribesEarned.length > 0
            ) {
              let shouldReturn = false;

              for (let i = 0; i < pair.gauge.bribesEarned.length; i++) {
                if (BigNumber(pair.gauge.bribesEarned[i].earned).gt(0)) {
                  shouldReturn = true;
                }
              }

              return shouldReturn;
            }

            return false;
          })
          .map((pair) => {
            pair.rewardType = "Bribe";
            return pair;
          });

        const veDistContract = new web3.eth.Contract(
          CONTRACTS.VE_DIST_ABI,
          CONTRACTS.VE_DIST_ADDRESS
        );
        const veDistEarned = await veDistContract.methods
          .claimable(tokenID)
          .call();
        const vestNFTs = this.getStore("vestNFTs");
        let theNFT = vestNFTs.filter((vestNFT) => {
          return vestNFT.id == tokenID;
        });

        if (BigNumber(veDistEarned).gt(0)) {
          veDistReward.push({
            token: theNFT[0],
            lockToken: veToken,
            rewardToken: govToken,
            earned: BigNumber(veDistEarned)
              .div(10 ** govToken.decimals)
              .toFixed(govToken.decimals),
            rewardType: "Distribution",
          });
        }
      }

      const filteredFees = [];
      for (let i = 0; i < pairs.length; i++) {
        let pair = Object.assign({}, pairs[i]);
        if (
          BigNumber(pair.claimable0).gt(0) ||
          BigNumber(pair.claimable1).gt(0)
        ) {
          pair.rewardType = "Fees";
          filteredFees.push(pair);
        }
      }
      const rewardsEarned = await Promise.all(
        filteredPairs2.map(async (pair) => {
          const gaugeContract = new web3.eth.Contract(
            CONTRACTS.GAUGE_ABI,
            pair.gauge.address
          );

          const [earned] = await Promise.all([
            gaugeContract.methods
              .earned(CONTRACTS.GOV_TOKEN_ADDRESS, account.address)
              .call(),
          ]);

          pair.gauge.rewardsEarned = BigNumber(earned)
            .div(10 ** 18)
            .toFixed(18);

          return pair;
        })
      );
      const filteredRewards = [];
      for (let j = 0; j < rewardsEarned.length; j++) {
        let pair = Object.assign({}, rewardsEarned[j]);
        if (
          pair.gauge &&
          pair.gauge.rewardsEarned &&
          BigNumber(pair.gauge.rewardsEarned).gt(0)
        ) {
          pair.rewardType = "Reward";
          filteredRewards.push(pair);
        }
      }

      const rewards = {
        bribes: filteredBribes,
        fees: filteredFees,
        rewards: filteredRewards,
        veDist: veDistReward,
      };

      this.setStore({
        rewards,
      });

      this.emitter.emit(ACTIONS.REWARD_BALANCES_RETURNED, rewards);
    } catch (ex) {
      console.error(ex);
      this.emitter.emit(ACTIONS.ERROR, ex);
    }
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
