import BigNumber from "bignumber.js";
import {ACTIONS, CONTRACTS} from "./../constants";
import {parseBN, formatBN} from '../../utils';
import {enrichPositionInfoToPairs, getPairContract, loadUserInfoFromSubgraph} from "./pair-helper";
import {enrichLogoUri} from "./token-helper";
import {multicallRequest} from "./multicall-helper";

let rewardsLoading = false;

function bribeModel(
  symbol,
  token0,
  token1,
  totalSupply,
  gaugeTotalSupply,
  balance,
  gaugeReserve0,
  gaugeReserve1
) {
  return {
    rewardType: "Bribe",
    symbol: symbol,
    token0: token0,
    token1: token1,
    balance: balance,
    reserve0: "0",
    reserve1: "0",
    gauge: {
      balance: balance,
      totalSupply: gaugeTotalSupply,
      reserve0: gaugeReserve0,
      reserve1: gaugeReserve1,
      bribesEarned: []
    }
  }
}

async function getVeDistRewards(
  web3,
  tokenID,
  vestNFTs,
  govToken,
  veToken
) {
  const veDistReward = [];
  if (!tokenID || parseInt(tokenID) === 0) {
    return veDistReward;
  }
  const veDistContract = new web3.eth.Contract(
    CONTRACTS.VE_DIST_ABI,
    CONTRACTS.VE_DIST_ADDRESS
  );
  const veDistEarned = await veDistContract.methods.claimable(tokenID).call();
  let theNFT = vestNFTs.filter((vestNFT) => parseInt(vestNFT.id) === parseInt(tokenID));


  if (BigNumber(veDistEarned).gt(0)) {
    veDistReward.push({
      token: theNFT[0],
      lockToken: veToken,
      rewardToken: govToken,
      earned: formatBN(veDistEarned),
      rewardType: "Distribution",
    });
  }
  return veDistReward;
}

async function collectBribeRewards(tokenID, userInfo, web3, baseAssets) {
  if (!tokenID || parseInt(tokenID) === 0) {
    return [];
  }
  let tokenIdAdr = null;
  const bribes = userInfo?.nfts?.filter(nft => parseInt(nft.id) === parseInt(tokenID))[0]?.bribes;
  const result = [];


  for (const bribeEntity of bribes) {
    const bribe = bribeEntity.bribe
    const bribeContract = new web3.eth.Contract(CONTRACTS.BRIBE_ABI, bribe.id);

    if (tokenIdAdr === null) {
      tokenIdAdr = await bribeContract.methods.tokenIdToAddress(tokenID).call()
    }

    const gaugePosition = userInfo?.gaugePositions?.filter(pos => pos.gauge.pair.id.toLowerCase() === bribe.pair.id)[0];
    const balance = gaugePosition?.balance ?? "0";
    const gaugeTotalSupply = gaugePosition?.gauge?.totalSupply ?? "0";

    const gaugeRatio = BigNumber(gaugeTotalSupply).div(bribe.pair.totalSupply)
    const gaugeReserve0 = BigNumber(bribe.pair.reserve0).times(gaugeRatio).toString();
    const gaugeReserve1 = BigNumber(bribe.pair.reserve1).times(gaugeRatio).toString();

    enrichLogoUri(baseAssets, bribe.pair.token0);
    enrichLogoUri(baseAssets, bribe.pair.token1);

    const model = bribeModel(
      bribe.pair.symbol,
      bribe.pair.token0,
      bribe.pair.token1,
      bribe.pair.totalSupply,
      gaugeTotalSupply,
      balance,
      gaugeReserve0,
      gaugeReserve1
    );
    for (const rt of bribe.bribeTokens) {
      const earned = await bribeContract.methods.earned(rt.token.id, tokenIdAdr).call();
      if (!BigNumber(earned).isZero()) {
        enrichLogoUri(baseAssets, rt.token);

        model.gauge.bribesEarned.push({
          earned: formatBN(earned, rt.token.decimals),
          token: {
            symbol: rt.token.symbol,
            logoURI: rt.token.logoURI,
          },
        })
      }
    }
    result.push(model);
  }

  return result;
}

async function collectSwapFeesRewards(pairs, web3, userAdr, multicall, baseAssets) {
  const filteredFees = [];
  const pairsWithPositions = pairs.filter(p => !!p.userPosition);

  const results = await multicallRequest(multicall, pairsWithPositions, (calls, el) => {
    const pairContract = getPairContract(web3, el.id);
    calls.push(pairContract.methods.claimable0(userAdr))
    calls.push(pairContract.methods.claimable1(userAdr))
  })

  for (let i = 0; i < pairsWithPositions.length; i++) {
    let pair = Object.assign({}, pairsWithPositions[i]);

    pair.claimable0 = formatBN(results[i * 2], pair.token0.decimals);
    pair.claimable1 = formatBN(results[i * 2 + 1], pair.token1.decimals);

    if (
      BigNumber(pair.claimable0).gt(0) ||
      BigNumber(pair.claimable1).gt(0)
    ) {
      enrichLogoUri(baseAssets, pair.token0);
      enrichLogoUri(baseAssets, pair.token1);
      pair.rewardType = "Fees";
      filteredFees.push(pair);
    }
  }
  return filteredFees;
}

async function collectGaugeRewards(
  multicall,
  pairs,
  web3,
  userAddress,
  baseAssets
) {
  const pairsWithPositions = pairs.filter(p => !!p.userPosition).map(p => Object.assign({}, p));

  const results = await multicallRequest(multicall, pairsWithPositions, (calls, pair) => {
    const gaugeContract = new web3.eth.Contract(CONTRACTS.GAUGE_ABI, pair.gauge.id);
    for (const rt of pair.gauge.rewardTokens) {
      calls.push(gaugeContract.methods.earned(rt.token.id, userAddress))
    }
  })

  let count = 0;
  pairsWithPositions.forEach((pair) => {
    pair.rewardType = "Reward";
    pair.gauge.rewardTokens.forEach((rt, i) => {
      rt.rewardsEarned = formatBN(results[i + count], rt.token.decimals);
      if (!BigNumber(rt.rewardsEarned).isZero()) {
        enrichLogoUri(baseAssets, rt.token);
      }
    });
    count += pair.gauge.rewardTokens.length;
  })

  return pairsWithPositions
    .filter(pair => pair.gauge.rewardTokens.reduce((a, b) => a + +b.rewardsEarned, 0) > 0)
}

export const getRewardBalances = async (
  payload,
  account,
  web3,
  emitter,
  pairs,
  veToken,
  govToken,
  vestNFTs,
  baseAssets,
  multicall
) => {
  const userAddress = account?.address;
  const {tokenID} = payload.content;
  if (rewardsLoading || !userAddress || !tokenID) {
    return null;
  }
  rewardsLoading = true;
  try {

    const userInfo = await loadUserInfoFromSubgraph(userAddress)
    enrichPositionInfoToPairs(pairs, userInfo)

    const result = [];

    // VE DIST
    const veDist = await getVeDistRewards(
      web3,
      tokenID,
      vestNFTs,
      govToken,
      veToken
    );
    if (veDist && veDist.length > 0) {
      result.push(...veDist);
    }

    // GAUGE REWARDS
    const gauges = await collectGaugeRewards(
      multicall,
      pairs,
      web3,
      userAddress,
      baseAssets
    );
    if (gauges && gauges.length > 0) {
      result.push(...gauges);
    }

    // BRIBES
    const bribes = await collectBribeRewards(tokenID, userInfo, web3, baseAssets);
    if (bribes && bribes.length > 0) {
      result.push(...bribes);
    }

    // SWAP FEES
    const swapFees = await collectSwapFeesRewards(
      pairs,
      web3,
      userAddress,
      multicall,
      baseAssets
    )
    if (swapFees && swapFees.length > 0) {
      result.push(...swapFees);
    }

    return result;
  } catch (ex) {
    console.error("Collect rewards info error", ex);
    emitter.emit(ACTIONS.ERROR, ex);
  } finally {
    rewardsLoading = false;
  }
};


