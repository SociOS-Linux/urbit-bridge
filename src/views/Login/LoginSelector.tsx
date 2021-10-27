import React, { useCallback, useState } from 'react';
import cn from 'classnames';
import { Grid } from 'indigo-react';
import { Box, Button, Icon, Row, Text } from '@tlon/indigo-react';
import { useHistory } from 'store/history';
import { Just, Nothing } from 'folktale/maybe';
import { FORM_ERROR } from 'final-form';

import { useWallet } from 'store/wallet';
import { useNetwork } from 'store/network';
import { usePointCursor } from 'store/pointCursor';

import { WALLET_TYPES } from 'lib/constants';
import { MetamaskWallet } from 'lib/metamask';
import { getAuthToken } from 'lib/authToken';
import * as need from 'lib/need';
import { useWalletConnect } from 'lib/useWalletConnect';

import Window from 'components/L2/Window/Window';
import HeaderPane from 'components/L2/Window/HeaderPane';
import BodyPane from 'components/L2/Window/BodyPane';
import Modal from 'components/L2/Modal';
import L2BackButton from 'components/L2/Headers/L2BackButton';
import './LoginSelector.scss';
import { NAMES } from './Other';

interface LoginSelectorProps {
  className: string;
  views: { [key: string]: React.ReactNode };
  options: {
    text: string;
    value: string;
    menuIcon: React.ReactNode;
    headerIcon: React.ReactNode;
  }[];
  currentTab?: string;
  setCurrentTab: (tab?: string) => void;
  goHome: () => void;
}

export default function LoginSelector({
  className,
  views,
  options,
  currentTab,
  setCurrentTab,
  goHome,
  // Tab props
  ...rest
}: LoginSelectorProps) {
  const { push, names }: any = useHistory();
  const [showModal, setShowModal] = useState(false);

  const {
    setWallet,
    setWalletType,
    resetWallet,
    setAuthToken,
  }: any = useWallet();

  const { setPointCursor }: any = usePointCursor();
  const { authenticate } = useWalletConnect();
  const { web3 }: any = useNetwork();
  const _web3 = need.web3(web3);

  const goToActivate = useCallback(() => push(names.ACTIVATE), [
    push,
    names.ACTIVATE,
  ]);

  const connectWalletConnect = async () => {
    resetWallet();
    setWalletType(WALLET_TYPES.WALLET_CONNECT);
    setPointCursor(Nothing());
    await authenticate();
    goHome();
  };

  const connectMetamask = useCallback(async () => {
    try {
      resetWallet();
      setWalletType(WALLET_TYPES.METAMASK);
      setPointCursor(Nothing());

      const accounts = await (window as any).ethereum.send(
        'eth_requestAccounts'
      );
      const wallet = new MetamaskWallet(accounts.result[0]);

      const authToken = await getAuthToken({
        address: wallet.address,
        walletType: WALLET_TYPES.METAMASK,
        web3: _web3,
      });

      setAuthToken(Just(authToken));
      setWallet(Just(wallet));
      setWalletType(WALLET_TYPES.METAMASK);
      goHome();
    } catch (e) {
      console.error(e);
      return { [FORM_ERROR]: (e as any).message };
    }
  }, [
    _web3,
    setAuthToken,
    setWallet,
    setWalletType,
    resetWallet,
    setPointCursor,
    goHome,
  ]);

  const selectOption = (value: string) => () => {
    if (value === NAMES.METAMASK) {
      connectMetamask();
    } else if (value === NAMES.WALLET_CONNECT) {
      connectWalletConnect();
    } else {
      setCurrentTab(value);
    }
  };

  if (!currentTab) {
    return (
      <Grid className={className}>
        {options.map((option, i) => (
          <React.Fragment key={option.value}>
            <Grid.Item
              full
              className={cn('f5 pv3 rel pointer login-menu-item')}
              onClick={selectOption(option.value)}>
              {option.text}
              {option.menuIcon}
            </Grid.Item>
          </React.Fragment>
        ))}
        <Grid.Item full className="activate" as={Button} onClick={goToActivate}>
          Activate a Planet
        </Grid.Item>
        <Grid.Item
          full
          className="unsupported-info"
          as={Text}
          onClick={() => setShowModal(true)}>
          <Icon icon="Info" />I have a wallet type not supported here
        </Grid.Item>
        <Modal show={showModal} hide={() => setShowModal(false)}>
          <Box className="info-modal-content">
            <Box className="close" onClick={() => setShowModal(false)}>
              &#215;
            </Box>
            <span>
              <span className="fw-bold">Other Wallet Types</span> <br />
              All other wallet types are now supported via Metamask or
              WalletConnect.
              <br />
              <br />
              If you are you using a{' '}
              <span className="fw-bold">
                Hardware Wallet, Ethereum Keystore, Ethereum Private Key
              </span>{' '}
              please use Metamask going forward.
              <br />
              <br />
              If you are using a{' '}
              <span className="fw-bold">non-custodial wallet</span> or{' '}
              <span className="fw-bold">mobile wallet</span>, please use
              WalletConnect going forward.
            </span>
          </Box>
        </Modal>
      </Grid>
    );
  }

  const Tab = views[currentTab];
  const currentOption = options.find(({ value }) => value === currentTab);

  return (
    <Box display="flex" flexDirection="column">
      <L2BackButton className="mb4" onBack={() => setCurrentTab(undefined)} />
      <Window>
        <HeaderPane>
          <Row className="header-row">
            <h5>{currentOption?.text}</h5>
            {currentOption?.headerIcon}
          </Row>
        </HeaderPane>
        <BodyPane className="login-body-pane">
          <Grid.Item
            full
            as={Tab}
            {...rest}
            goHome={goHome}
            className="login-selector"
          />
        </BodyPane>
      </Window>
    </Box>
  );
}
