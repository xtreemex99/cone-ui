import { Typography, Button, Paper, SvgIcon } from "@mui/material"
import LiquidityPairs from '../../components/ssLiquidityPairs'

import React, { useState, useEffect } from 'react';
import { ACTIONS } from '../../stores/constants';

import stores from '../../stores';
import { useRouter } from "next/router";
import Unlock from '../../components/unlock';

import classes from './liquidity.module.css';
import { useAppThemeContext } from '../../ui/AppThemeProvider';
import BtnEnterApp from '../../ui/BtnEnterApp';

function Liquidity({ changeTheme }) {

  const accountStore = stores.accountStore.getStore('account');
  const router = useRouter();
  const [account, setAccount] = useState(accountStore);
  const [unlockOpen, setUnlockOpen] = useState(false);

  useEffect(() => {
    const accountConfigure = () => {
      const accountStore = stores.accountStore.getStore('account');
      setAccount(accountStore);
      closeUnlock();
    };
    const connectWallet = () => {
      onAddressClicked();
    };

    stores.emitter.on(ACTIONS.ACCOUNT_CONFIGURED, accountConfigure);
    stores.emitter.on(ACTIONS.CONNECT_WALLET, connectWallet);
    return () => {
      stores.emitter.removeListener(ACTIONS.ACCOUNT_CONFIGURED, accountConfigure);
      stores.emitter.removeListener(ACTIONS.CONNECT_WALLET, connectWallet);
    };
  }, []);

  const onAddressClicked = () => {
    setUnlockOpen(true);
  };

  const closeUnlock = () => {
    setUnlockOpen(false);
  };

  const {appTheme} = useAppThemeContext();

  const [isHoverState, setIsHoverState] = useState(false);
  const [isClickState, setIsClickState] = useState(false);
  const [btnColor, setBtnColor] = useState(appTheme === 'dark' ? '#33284C' : '#D2D0F2');

  const btnDefaultColor = () => {
    setIsHoverState(false);
    setIsClickState(false);
  };

  const btnHoverColor = () => {
    setIsHoverState(true);
  };

  const btnClickColor = () => {
    setIsClickState(true);
  };

  const getBtnColor = () => {
    switch (appTheme) {
      case 'dark':
        return isClickState ? '#523880' : (isHoverState ? '#402E61' : '#33284C');

      case 'light':
      default:
        return isClickState ? '#B9A4EE' : (isHoverState ? '#C6BAF0' : '#D2D0F2');
    }
  };

  return (
    <>
      {account && account.address ?
        <LiquidityPairs />
        :
        <Paper className={classes.notConnectedContent}>
          <div className={classes.contentFloat}>
            <Typography className={classes.contentFloatText}>
              Liquidity
            </Typography>

            <div className={[classes.mainDescBg, classes[`mainDescBg--${appTheme}`]].join(' ')}>
              <Typography className={[classes.mainDescNC, classes[`mainDescNC--${appTheme}`]].join(' ')} variant="body2">
                Create a pair or add liquidity to existing stable or volatile Liquidity Pairs.
              </Typography>
            </div>

            <div
              className={[classes.buttonConnect, classes[`buttonConnect--${appTheme}`]].join(' ')}
              onMouseOver={btnHoverColor}
              onMouseOut={btnDefaultColor}
              onMouseDown={btnClickColor}
              onClick={onAddressClicked}>
              <BtnEnterApp
                labelClassName={classes.buttonEnterLabel}
                label={`Connect wallet\nto continue`}
                btnColor={getBtnColor}
              />
            </div>
          </div>
        </Paper>
       }
       {unlockOpen && <Unlock modalOpen={unlockOpen} closeModal={closeUnlock} />}
    </>
  );
}

export default Liquidity;
