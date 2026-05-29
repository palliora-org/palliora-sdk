import bs58 from 'bs58';
import { getApi } from '../chain';

export interface GuardianParticipants {
	nwState: {
		localPeerId: string | undefined;
		worker: unknown;
		currentEra: unknown;
		guardians: string | null;
		nextGuardians: string | null;
		currentIndex: unknown;
		nextIndex: number;
	};
	currentGuardians: unknown[];
	upcomingGuardians: unknown[];
}

export async function getGuardianParticipants(): Promise<GuardianParticipants> {
	const api = await getApi();
	if (!api) throw new Error('Api not initialized');

	try {
		const guardians = await api.query.guardian.guardians();
		const nextGuardians = await api.query.guardian.nextGuardians();
		const currentEra = await api.query.staking.currentEra();
		const currentIndex = await api.query.guardian.currentIndex();
		const peerid = await api.rpc.system.localPeerId();
		const _peerid = bs58.decode((peerid || '').toString());
		const account = await api.query.guardian.workerByKey(_peerid.slice(6, 38));
		const nextIndex = currentIndex ? Number(currentIndex) + 1 : 1;

		const guardiansList = (guardians?.toJSON() || []) as string[];
		const nextGuardiansList = (nextGuardians?.toJSON() || []) as string[];

		const buildDetails = async (list: string[]) => {
			return Promise.all(
				list.map(async (guardian: string) => {
					const guardianPrefs = await api.query.staking.guardians(guardian);
					const ledger = await api.query.staking.ledger(guardian);
					const bonded = await api.query.staking.bonded(guardian);
					const payee = await api.query.staking.payee(guardian);
					const stakersOverview = await api.query.staking.erasStakersOverview(
						currentEra?.toPrimitive(),
						guardian,
					);
					const guardianErasPrefs = await api.query.staking.erasGuardianPrefs(
						currentEra?.toPrimitive(),
						guardian,
					);

					return {
						guardian,
						rewardDestination: payee?.toHuman ? payee.toHuman() : null,
						currentPreferences: (guardianErasPrefs?.toHuman ? guardianErasPrefs.toHuman() : null),
						upcomingPreferences: (guardianPrefs?.toHuman ? guardianPrefs.toHuman() : null),
						stash: bonded?.toHuman ? bonded.toHuman() : null,
						currentStakeOverview: stakersOverview?.toHuman ? stakersOverview.toHuman() : null,
						upcomingStakeOverview: ledger?.toHuman ? ledger.toHuman() : null,
					};
				}),
			);
		};

		const currentGuardians = await buildDetails(guardiansList);
		const upcomingGuardians = await buildDetails(nextGuardiansList);

		return {
            nwState: {
                localPeerId: peerid?.toString(),
                worker: account?.toHuman ? account.toHuman() : null,
                currentEra: currentEra?.toHuman ? currentEra.toHuman() : null,
                guardians: JSON.stringify(guardians?.toHuman ? guardians.toHuman() : null, null, 2),
                nextGuardians: JSON.stringify(nextGuardians?.toHuman ? nextGuardians.toHuman() : null, null, 2),
                currentIndex: currentIndex?.toHuman ? currentIndex.toHuman() : null,
                nextIndex,
            },
			currentGuardians,
			upcomingGuardians,
		};
	} finally {
		api.disconnect();
	}
}

export default getGuardianParticipants;

