import React, { useCallback, useMemo } from 'react';
import { Just, Nothing } from 'folktale/maybe';
import * as bip32 from 'bip32';
import { times } from 'lodash';
import TrezorConnect from 'trezor-connect';
import * as secp256k1 from 'secp256k1';
import {
  Text,
  Input,
  Grid,
  H5,
  CheckboxInput,
  SelectInput,
} from 'indigo-react';

import { useWallet } from 'store/wallet';

import { TREZOR_PATH } from 'lib/trezor';
import { WALLET_TYPES } from 'lib/wallet';
import useLoginView from 'lib/useLoginView';

import {
  composeValidator,
  buildCheckboxValidator,
  buildSelectValidator,
  buildHdPathValidator,
} from 'form/Inputs';
import BridgeForm from 'form/BridgeForm';
import Condition from 'form/Condition';
import ContinueButton from './ContinueButton';
import FormError from 'form/FormError';

const ACCOUNT_OPTIONS = times(20, i => ({
  text: `Account #${i + 1}`,
  value: i,
}));

// see Ledger.js for context — Trezor is basicaly Ledger with less complexity
export default function Trezor({ className }) {
  useLoginView(WALLET_TYPES.TREZOR);

  const { setWallet, setWalletHdPath } = useWallet();

  const validate = useMemo(
    () =>
      composeValidator({
        useCustomPath: buildCheckboxValidator(),
        account: buildSelectValidator(ACCOUNT_OPTIONS),
        hdpath: buildHdPathValidator(),
      }),
    []
  );

  const onSubmit = useCallback(
    async values => {
      TrezorConnect.manifest({
        email: 'bridge-trezor@urbit.org',
        appUrl: 'https://github.com/urbit/bridge',
      });

      const info = await TrezorConnect.getPublicKey({
        path: values.hdpath,
      });

      if (info.success === true) {
        const payload = info.payload;
        const publicKey = Buffer.from(payload.publicKey, 'hex');
        const chainCode = Buffer.from(payload.chainCode, 'hex');
        const pub = secp256k1.publicKeyConvert(publicKey, true);
        const hd = bip32.fromPublicKey(pub, chainCode);
        setWallet(Just(hd));
        setWalletHdPath(values.hdPath);
      } else {
        setWallet(Nothing());
      }
    },
    [setWallet, setWalletHdPath]
  );

  const onValues = useCallback(({ valid, values, form }) => {
    if (!valid) {
      return;
    }

    if (!values.useCustomPath) {
      form.change('hdpath', TREZOR_PATH.replace(/x/g, values.account));
    }
  }, []);

  return (
    <Grid className={className}>
      <Grid.Item full as={H5}>
        Authenticate With Your Trezor
      </Grid.Item>

      <Grid.Item full as={Text} className="f6 mb3">
        Connect and authenticate to your Trezor. If you'd like to use a custom
        derivation path, you may enter it below.
      </Grid.Item>

      <BridgeForm
        validate={validate}
        onValues={onValues}
        onSubmit={onSubmit}
        initialValues={{
          useCustomPath: false,
          hdpath: TREZOR_PATH.replace(/x/g, ACCOUNT_OPTIONS[0].value),
          account: ACCOUNT_OPTIONS[0].value,
        }}>
        {({ handleSubmit }) => (
          <>
            <Condition when="useCustomPath" is={true}>
              <Grid.Item full as={Input} name="hdpath" label="HD Path" />
            </Condition>

            <Condition when="useCustomPath" is={false}>
              <Grid.Item
                full
                as={SelectInput}
                name="account"
                label="Account"
                placeholder="Choose account..."
                options={ACCOUNT_OPTIONS}
              />
            </Condition>

            <Grid.Item
              full
              as={CheckboxInput}
              className="mv3"
              name="useCustomPath"
              label="Custom HD Path"
            />

            <Grid.Item full as={FormError} />

            <Grid.Item full as={ContinueButton} handleSubmit={handleSubmit}>
              Authenticate
            </Grid.Item>
          </>
        )}
      </BridgeForm>
    </Grid>
  );
}
