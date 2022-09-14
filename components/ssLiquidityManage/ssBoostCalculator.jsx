import React, {useEffect, useState} from 'react';
import classes from './ssBoostCalculator.module.css';
import {useRouter} from 'next/router';
import ThreePointSlider from '../threePointSlider/threePointSlider';
import BigNumber from "bignumber.js";
import {calculateBoost, calculatePowerForMaxBoost} from "../../stores/helpers/pair-helper";

export default function ssBoostCalculator({pair, nft, ve}) {
  const router = useRouter();
  const boostedType = 'boosted';

  const [ isShowNote, setIsShowNote ] = useState(false);
  const [ isShowCreateAction, setIsShowCreateAction ] = useState(false);
  const [ currentAPRPercentage, setCurrentAPRPercentage ] = useState(0);
  const [ boostedAPRPercentage, setBoostedAPRPercentage ] = useState(0);
  const [ currentAPRAmount, setCurrentAPRAmount ] = useState(0);
  const [ boostedAPRAmount, setBoostedAPRAmount ] = useState(0);
  const [ usedVeConePercentage, setUsedVeConePercentage ] = useState(0);
  const [ aprLimits, setAprLimits ] = useState({ min: 0, max: 100 }); // Percentage only
  const [ veConeLimits, setVeConeLimits ] = useState({ min: 0, max: 1000 });


  useEffect(() => {

    if (pair && ve) {
      // min/max APR is static values, need to calculate proportion between APR to Power for UI
      const maxApr = BigNumber(pair.gauge.derivedAPR).toFixed(2);
      const minApr = BigNumber(pair.gauge.derivedAPR).times(0.4).toFixed(2);

      // gauge balance - exist or future balance, need to set from input field
      // const userGaugeBalance = pair.gauge.balance;
      const userGaugeBalance = 1000;

      // lock value it is veCONE power, if no NFT equals zero
      const lockValue = BigNumber(nft?.lockValue ?? 0)
      const veRatio = lockValue.div(ve.totalPower).toString()

      // aprWithout boost will be the same as minAPR
      // personal APR is dynamic
      const {personalAPR, aprWithoutBoost} = calculateBoost(pair, veRatio, userGaugeBalance);

      // calc $ per day doesn't depend on anything and simple math on APR and user balance
      const userGaugeBalanceEth = BigNumber(userGaugeBalance).times(BigNumber(pair.reserveETH).div(pair.totalSupply));
      const userGaugeBalanceUsd = userGaugeBalanceEth.times(pair.ethPrice);
      const earnPerDay = userGaugeBalanceUsd.times(personalAPR).div(365).toFixed(2);

      // max value for the UI, user can have enough power - then show max possible APR
      const maxPower = calculatePowerForMaxBoost(pair, userGaugeBalance, ve.totalPower);

      // console.log('maxApr', maxApr);
      // console.log('minApr', minApr);
      // console.log('userGaugeBalance', userGaugeBalance);
      // console.log('lockValue', lockValue.toString());
      // console.log('veRatio', veRatio);
      // console.log('personalAPR', personalAPR.toString());
      // console.log('aprWithoutBoost', aprWithoutBoost.toString());
      // console.log('userGaugeBalanceUsd', userGaugeBalanceUsd.toString());
      // console.log('earnPerDay', earnPerDay);
      // console.log('maxPower', maxPower);


      setCurrentAPRPercentage(parseFloat(personalAPR.toFixed(2))); // Set default value of APR% (show in Calculator and Default place of thumb of slider)
      setCurrentAPRAmount(parseFloat(earnPerDay)); // APR amount per day (show in Calculator)
      setBoostedAPRPercentage(parseFloat(personalAPR.toFixed(2))); // Default value for boosted APR%.
      setBoostedAPRAmount(45); // Boosted APR amount per day (show in Calculator)
      setUsedVeConePercentage(12); // Value of user's used veCone % (Slider will start from this position)

      setAprLimits({min: parseFloat(minApr), max: parseFloat(maxApr)}); // Limits for slider, min & max APR%
      setVeConeLimits({min: 0, max: parseFloat(maxPower)}); // Limits for slider, veCone min & max. It should be linear dependency with APR%
    }
  }, [pair]);

  useEffect(() => {
    setIsShowNote(boostedAPRPercentage === usedVeConePercentage || boostedAPRPercentage === aprLimits.min);
    setIsShowCreateAction(boostedAPRPercentage > usedVeConePercentage && boostedAPRPercentage > 0);
  }, [ boostedAPRPercentage ]);

  const createAction = () => {
    router.push('/vest/create').then();
  }

  const profitRender = (type = 'current') => {
    const label = type === 'current' ? `Current APR <span>${currentAPRPercentage}%</span>` : `Boosted APR <span>${boostedAPRPercentage}%</span>`;
    const value = type === 'current' ? `${currentAPRAmount} $ / day` : `${boostedAPRAmount} $ / day`;
    const hasProfit = boostedAPRPercentage > currentAPRPercentage;
    return (
        <>
          <div
              className={[ classes.profitLabel, classes[ `profitLabel--${hasProfit && type === boostedType ? 'profit' : 'shortage'}` ] ].join(' ')}
              dangerouslySetInnerHTML={{ __html: label }}/>
          <div className={classes.profitValue}>{value}</div>
        </>
    );
  }
  const noteRender = <div className={classes.sliderNote}>
    <div className={classes.sliderNoteWarnSymbol}>
      !
    </div>
    <div>
      Move slider above to calculate the veCONE Power for Max Boosted Rewards.
    </div>
  </div>;
  const onChange = ({ current }) => {
    setBoostedAPRPercentage(current);
  }

  return (
      <div className={classes.boostCalculator}>
        <div className={classes.sliderWrapper}>
          <div className={classes.sliderLabels}>
            <div className={classes.sliderLabelsItem}>
              Min-Max APR
            </div>
            <div className={classes.sliderLabelsItem}>
              veCONE
            </div>
          </div>
          <div className={classes.slider}>
            <ThreePointSlider
                valueLabelDisplay="on"
                pointCurrent={currentAPRPercentage}
                pointUsed={usedVeConePercentage}
                pointMinPct={aprLimits.min}
                pointMaxPct={aprLimits.max}
                pointMinValue={veConeLimits.min}
                pointMaxValue={veConeLimits.max}
                step={1}
                disabled={false}
                onChange={onChange}
            />
          </div>
          <div className={[ classes.sliderLabels, classes[ 'sliderLabels--mobile' ] ].join(' ')}>
            <div className={classes.sliderLabelsItem}>
              veCONE
            </div>
          </div>
        </div>
        {isShowNote && noteRender}
        <div className={classes.profitWrapper}>
          <div className={classes.profitItem}>{profitRender()}</div>
          {!isShowNote && <>
            <div className={classes.profitItemDivider}></div>
            <div className={classes.profitItem}>{profitRender(boostedType)}</div>
          </>}
        </div>
        {isShowCreateAction && <div className={classes.createAction}>
          <div className={classes.createActionNote}>You need to have NFT with 50K veCONE Power. Create or select/merge
            NFTs.
          </div>
          <div className={classes.createActionButton} onClick={createAction}>Create veCone</div>
        </div>}
      </div>
  );
}
