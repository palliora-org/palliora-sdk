
export const API_RPC = {
	kate: {
		queryRows: {
			description: "",
			params: [
				{
					name: "rows",
					type: "Vec<u32>",
				},
				{
					name: "at",
					type: "Hash",
					isOptional: true,
				},
			],
			type: "Vec<GRow>",
		},
		queryProof: {
			description: "Generate the kate proof for the given `cells`",
			params: [
				{
					name: "cells",
					type: "Vec<Cell>",
				},
				{
					name: "at",
					type: "Hash",
					isOptional: true,
				},
			],
			type: "Vec<GDataProof>",
		},
		blockLength: {
			description: "Get Block Length",
			params: [
				{
					name: "at",
					type: "Hash",
					isOptional: true,
				},
			],
			type: "BlockLength",
		},
		queryDataProof: {
			description: "Generate the data proof for the given `transaction_index`",
			params: [
				{
					name: "transaction_index",
					type: "u32",
				},
				{
					name: "at",
					type: "Hash",
					isOptional: true,
				},
			],
			type: "ProofResponse",
		},
	},
	guardian: {
		runtimeInfo: {
			description: "Fetch guardian runtime info",
			params: [
				{
					name: 'at',
					type: 'Hash',
					isOptional: true
				}
			],
			type: 'GuardianInfo'
		},
		guardianList: {
			description: "Fetch guardian list",
			params: [],
			type: 'Vec<String>'
		},
		guardianNwParams: {
			description: "Fetch guardian network parameters",
			params: [],
			type: 'GuardianNwParams'
		}
	},
};

export const API_TYPES = {
	GuardianInfo: {
		active: 'u32',
		maximum: 'u32'
	},
	CurrencyId: {
		_enum: {
			Native: 'Null',
			USDC: 'Null',
			ForeignAsset: 'u32',
		},
	},
	GuardianNwParams: {
		kzg: 'Vec<u8>',
		aggKey: 'Vec<u8>'
	},
	AppId: "Compact<u32>",
	DataLookupItem: {
		appId: "AppId",
		start: "Compact<u32>",
	},
	CompactDataLookup: {
		size: "Compact<u32>",
		index: "Vec<DataLookupItem>",
	},
	KateCommitment: {
		rows: "Compact<u16>",
		cols: "Compact<u16>",
		commitment: "Vec<u8>",
		dataRoot: "H256",
	},
	V3HeaderExtension: {
		appLookup: "CompactDataLookup",
		commitment: "KateCommitment",
	},
	HeaderExtension: {
		_enum: {
			V1: null,
			V2: null,
			V3: "V3HeaderExtension",
		},
	},
	DaHeader: {
		parentHash: "Hash",
		number: "Compact<BlockNumber>",
		stateRoot: "Hash",
		extrinsicsRoot: "Hash",
		digest: "Digest",
		extension: "HeaderExtension",
	},
	Header: "DaHeader",
	CheckAppIdExtra: {
		appId: "AppId",
	},
	CheckAppIdTypes: {},
	CheckAppId: {
		extra: "CheckAppIdExtra",
		types: "CheckAppIdTypes",
	},
	FeePayload: {
		compute: "u128",
		guardian: "u128",
		verifier: "u128",
	},
	SilentThresholdParams: {
		tdParams: 'Vec<u8>',
		pkBytes: 'Vec<u8>',
		tauParams: 'Vec<u8>'
	},
	ThresholdParams: {
		_enum: {
		SilentThreshold: 'SilentThresholdParams'
		}
	},
	ChaCha20Poly1305Params: {
		nonce: '[u8; 12]'
	},
	Aes256GcmParams: {
		nonce: '[u8; 12]'
	},
	SymmetricParams: {
		_enum: {
		ChaCha20Poly1305: 'ChaCha20Poly1305Params',
		Aes256Gcm: 'Aes256GcmParams'
		}
	},
	KdfParams: {
		_enum: {
		HkdfSha256: 'Null',
		HkdfSha512: 'Null'
		}
	},
	Secp256k1Params: {
		recipientPublicKey: 'Vec<u8>',
		ephemeralPublicKey: 'Option<Vec<u8>>',
		compressed: 'bool',
		kdf: 'KdfParams',
		salt: 'Option<Vec<u8>>',
		info: 'Option<Vec<u8>>'
	},
	Ed25519Params: {
		recipientPublicKey: 'Vec<u8>',
		ephemeralPublicKey: 'Option<Vec<u8>>',
		kdf: 'KdfParams',
		salt: 'Option<Vec<u8>>',
		info: 'Option<Vec<u8>>'
	},
	AsymmetricParams: {
		_enum: {
		Secp256k1: 'Secp256k1Params',
		Ed25519: 'Ed25519Params'
		}
	},
	ThresholdHybridParams: {
		thresholdParams: 'ThresholdParams',
		symmetricParams: 'SymmetricParams'
	},
	AsymmetricHybridParams: {
		asymmetricParams: 'AsymmetricParams',
		symmetricParams: 'SymmetricParams'
	},
	CipherSuite: {
		_enum: {
		Plaintext: 'Null',
		ThresholdHybrid: 'ThresholdHybridParams',
		AsymmetricHybrid: 'AsymmetricHybridParams'
		}
	},
	ConfidentialityLevel: {
		_enum: {
		Trusted: 'u32',
		TEE: 'Null',
		FHE: 'Null',
		SMPC: 'Null'
		}
	},
	NativeExecuteDA: {
		_enum: ['Inference', 'ContractAccess']
	},
	NativeDataDA: {
		_enum: ['DaFalse', 'DaTrue']
	},
	DAInputInline: {
		data: 'Vec<u8>'
	},
	DAInputChainTransaction: {
		blockNumber: 'u64',
		extrinsicIndex: 'u32'
	},
	DAInputContractId: {
		id: '[u8; 32]'
	},
	DAInputIpfs: {
		cid: 'Vec<u8>',
		size: 'u64'
	},
	DAInputUrl: {
		url: 'Vec<u8>',
		size: 'u64',
		hash: 'Option<Vec<u8>>'
	},
	DAInput: {
		_enum: {
		Null: 'Null',
		Inline: 'DAInputInline',
		ChainTransaction: 'DAInputChainTransaction',
		ContractId: 'DAInputContractId',
		Ipfs: 'DAInputIpfs',
		Url: 'DAInputUrl',
		NativeExecute: 'NativeExecuteDA',
		NativeData: 'NativeDataDA'
		}
	},
	ContractType: {
		_enum: {
		Dormant: 'Null',
		Active: 'Null',
		Subscription: 'Null',
		}
	},
	StoreType: {
		_enum: {
		Dataset: 'Null',
		Model: 'Null',
		Agent: 'Null',
		Other: 'Null',
		Executable: 'Null'
		}
	},
	ComputeMetadata: {
		name: 'Vec<u8>',
		description: 'Vec<u8>',
		storeType: 'StoreType',
		groupId: 'H256',
	},
	ComputeInfo: {
		cipher: 'CipherSuite',
		computerIndices: 'Vec<u32>',
		fees: 'u128',
		computeRate: 'u128',
		deadline: 'u64',
		confidentiality: 'ConfidentialityLevel',
		feeFunction: 'Option<u8>',
		programEnv: 'Option<Vec<u8>>',
		input: 'DAInput',
		program: 'DAInput',
		metadata: 'Option<ComputeMetadata>',
	},
	Contract: {
		contractType: 'ContractType',
		guardians: 'Vec<AccountId>',
		preCheck: 'Option<ComputeInfo>',
		compute: 'ComputeInfo',
		postCheck: 'Option<ComputeInfo>',
		resultCipher: 'CipherSuite',
		currencyId: 'CurrencyId'
	},
	AgreementInfo: {
		status: 'AgreementStatus',
		creator: 'AccountId',
		index: 'u32'
	},
    ComputePayload: {
		daType: "u8",
		agreement: "Option<BoundedVec<[u8; 32], 10>>",
		verification: "u8",
		compute: "u8",
    },
	ComputePrefs: {
		trusted: "bool",
		tee: "bool",
		mpc: "bool",
		fhe: "bool",
		zkp: "bool",
	},
	ComputeType: {
		_enum: ["Trusted", "Tee", "Mpc", "Fhe", "Zkp"],
	},
	GuardianPrefs: {
		pubKey: "[u8; 32]",
		guardian: "bool",
		verifier: "bool",
		compute: "bool",
		computePrefs: "Option<ComputePrefs>",
		feeThresholds: "Vec<(ComputeType, u128)>",
	},
	BlockLengthColumns: "Compact<u32>",
	BlockLengthRows: "Compact<u32>",
	BlockLength: {
		max: "PerDispatchClass",
		cols: "BlockLengthColumns",
		rows: "BlockLengthRows",
		chunkSize: "Compact<u32>",
	},
	PerDispatchClass: {
		normal: "u32",
		operational: "u32",
		mandatory: "u32",
	},
	TxDataRoots: {
		dataRoot: "H256",
		blobRoot: "H256",
		bridgeRoot: "H256",
	},
	DataProof: {
		roots: "TxDataRoots",
		proof: "Vec<H256>",
		numberOfLeaves: "Compact<u32>",
		leafIndex: "Compact<u32>",
		leaf: "H256",
	},
	ProofResponse: {
		dataProof: "DataProof",
		message: "Option<AddressedMessage>",
	},
	AddressedMessage: {
		message: "Message",
		from: "H256",
		to: "H256",
		originDomain: "u32",
		destinationDomain: "u32",
		id: "u64",
	},
	Message: {
		_enum: {
			ArbitraryMessage: "ArbitraryMessage",
			FungibleToken: "FungibleToken",
		},
	},
	FungibleToken: {
		assetId: "H256",
		amount: "u128",
	},
	BoundedData: "Vec<u8>",
	ArbitraryMessage: "BoundedData",
	Cell: {
		row: "u32",
		col: "u32",
	},
	GRawScalar: "U256",
	GProof: "[u8; 48]",
	GRow: "Vec<GRawScalar>",
	GDataProof: "(GRawScalar, GProof)",
	AgreementStatus: {
		_enum: ['NotFound', 'Pending', 'Accepted', 'Rejected', 'Settled']
	},
	AcceptedSubStatus: {
		_enum: ['Running', 'AwaitingTopUp', 'TopUpReceived', 'RejectedInsufficientBudget', 'RejectedRateMismatch']
	},
	RejectedSubStatus: {
		_enum: ['InsufficientBudget', 'RateMismatch']
	},
	SettlementReason: {
		_enum: ['ResultReceived', 'DeadlineReached', 'BudgetExhausted']
	},
	ExecutionOutcome: {
		_enum: ['FullSettlement', 'PartialSettlement', 'Success', 'Failed', 'Terminated', 'TopUpTimeout']
	},
	ContractInfo: {
		status: 'AgreementStatus',
		owner: 'AccountId',
		originBlock: 'u32',
		invocationBlock: 'u32',
		index: 'u32',
		usagePrice: 'u128',
		contractType: 'ContractType',
	},
	SettlementInfo: {
		computeRate: 'u128',
		inputContractId: 'Option<[u8; 32]>',
		guardians: 'Vec<AccountId>',
	},
	AppKeyInfo: {
		owner: 'AccountId',
		id: 'AppId',
	},
	DataType: {
		_enum: ['Dataset', 'Model', 'Agent']
	},
};

export const DEFAULT_COMPUTE_PAYLOAD =  { compute: { daType: 0, verification: 0, compute: 0 } };
export const DEFAULT_EMPTY_PAYLOAD =  { compute: { daType: 0, verification: 0, compute: 0, agreement: [] } };

export const API_EXTENSIONS = {
	CheckAppId: {
		extrinsic: {
			appId: "AppId",
		},
		payload: {},
	},
	CheckCompute: {
		extrinsic: {
				compute: "ComputePayload",
		},
		payload: {},
	},
	// Replaces pallet_transaction_payment::ChargeTransactionPayment. Since this
	// identifier isn't one @polkadot/api knows natively, this definition entirely
	// replaces (not merges with) the built-in one, so `tip` must be re-declared
	// here alongside the new `currencyId` field or it silently drops from the
	// encoded extra bytes, shifting every extrinsic out of alignment.
	ChargeCurrencyTransactionPayment: {
		extrinsic: {
			tip: "Compact<Balance>",
			currencyId: "Option<CurrencyId>",
		},
		payload: {},
	},
};
