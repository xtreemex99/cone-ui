import CoinbaseWalletSDK from "@coinbase/wallet-sdk";
import WalletConnectProvider from "@walletconnect/web3-provider";

export const providerOptions = {
 coinbasewallet: {
   package: CoinbaseWalletSDK, 
   options: {
     appName: "Dystopia",
     infuraId: process.env.INFURA_KEY ,
   },
   infuraId: process.env.INFURA_KEY ,
 },
 walletconnect: {
   package: WalletConnectProvider, 
   options: {
    appName: "Dystopia",
    infuraId: process.env.INFURA_KEY ,
    rpc:{137:"https://polygon-mainnet.g.alchemy.com/v2/z31K9anv5tvGi7AxPhtSSD2FCBJvK0Wj"}

  },
  infuraId: process.env.INFURA_KEY ,

 }
};