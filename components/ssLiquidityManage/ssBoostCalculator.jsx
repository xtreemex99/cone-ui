import React, { useEffect, useState } from 'react';
import classes from './ssBoostCalculator.module.css';
import { useRouter } from 'next/router';
import ThreePointSlider from '../threePointSlider/threePointSlider';

export default function ssBoostCalculator() {
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
    setCurrentAPRPercentage(12); // Set default value of APR% (show in Calculator and Default place of thumb of slider)
    setCurrentAPRAmount(10); // APR amount per day (show in Calculator)
    setBoostedAPRPercentage(12); // Default value for boosted APR%.
    setBoostedAPRAmount(45); // Boosted APR amount per day (show in Calculator)
    setUsedVeConePercentage(12); // Value of user's used veCone % (Slider will start from this position)

    setAprLimits({ min: 2, max: 80 }); // Limits for slider, min & max APR%
    setVeConeLimits({ min: 1250, max: 50000 }); // Limits for slider, veCone min & max. It should be linear dependency with APR%
  }, []);

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
