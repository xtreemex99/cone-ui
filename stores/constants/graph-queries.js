
export const pairsQuery = `
{
  pairs(first: 1000) {
    id
    name
    symbol
    isStable
    reserve0
    reserve1
    token0Price
    token1Price
    totalSupply
    reserveUSD
    token0 {
      id
      symbol
      name
      decimals
      isWhitelisted
      derivedETH
    }
    token1 {
      id
      symbol
      name
      decimals
      isWhitelisted
      derivedETH
    }
    gauge {
      id
      totalSupply
      totalSupplyETH
      expectAPR
      voteWeight
      totalWeight
      bribe {
        id
      }
      rewardTokens {
        apr
      }
    }
    gaugebribes {
      id
      bribeTokens {
        apr
        left
        token {
          symbol
        }
      }
    }
  }
}
`;

export const tokensQuery = `
  query {
    tokens{
      id
      symbol
      name
      decimals
      isWhitelisted
      derivedETH
    }
  }
`;

export const bundleQuery = `
  query {
    bundle(id:1){
      ethPrice
    }
  }
`;

export const veDistQuery = `
{
  veDistEntities {
    apr
  }
}
`;

export const veQuery = `
query ve($id: ID!) {
  veNFTEntities(where: {id: $id}) {
    gauges {
      gauge {
        id
      }
    }
    bribes {
      id
    }    
  }
}
`;

export const userQuery = `
query user($id: ID!) {
  user(id: $id) {
    liquidityPositions{
          liquidityTokenBalance
          pair {
            id
            symbol
          }
        }
    gaugePositions {
      gauge {
        id
        pair {
          id
          symbol
        }
      }
    }
    nfts {
      id
      lockedAmount
      lockedEnd
      attachments
      votes {
        pool {
          id
          symbol
        }
        weight
        weightPercent
      }
      bribes {
        bribe {
          id
          pair {
            id
            symbol
          }
        }
      }
    }
  }
}
`;
