
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
	GuardianNwParams: {
		kzg: 'Vec<u8>',
		agg_key: 'Vec<u8>'
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
		td_params: 'Vec<u8>',
		pk_bytes: 'Vec<u8>',
		tau_params: 'Vec<u8>'
	},
	ThresholdAlgos: {
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
	SymmetricAlgos: {
		_enum: {
		ChaCha20Poly1305: 'ChaCha20Poly1305Params',
		Aes256Gcm: 'Aes256GcmParams'
		}
	},
	CipherSuiteEncrypted: {
		threshold: 'ThresholdAlgos',
		symmetric: 'SymmetricAlgos'
	},
	CipherSuite: {
		_enum: {
		Plaintext: 'Null',
		Encrypted: 'CipherSuiteEncrypted'
		}
	},
	ConfidentialityLevel: {
		_enum: ['Trusted', 'TEE', 'FHE', 'SMPC']
	},
	NativeExecuteDA: {
		_enum: ['Inference']
	},
	NativeDataDA: {
		_enum: ['DaFalse', 'DaTrue']
	},
	DAInputInline: {
		data: 'Vec<u8>'
	},
	DAInputChainTransaction: {
		block_number: 'u64',
		extrinsic_index: 'u32'
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
		Inline: 'DAInputInline',
		ChainTransaction: 'DAInputChainTransaction',
		Ipfs: 'DAInputIpfs',
		Url: 'DAInputUrl',
		NativeExecute: 'NativeExecuteDA',
		NativeData: 'NativeDataDA'
		}
	},
	ContractType: {
		_enum: {
		Dormant: "Dormant",
		Active: "Active"
		}
	},
	StoreType: {
		_enum: {
		Dataset: "Dataset",
		Model: "Model",
		Agent: "Agent",
		Other: "Other"
		}
	},
	ComputeMetadata: {
		name: 'Vec<u8>',
		description: 'Vec<u8>',
		store_type: 'StoreType',
		group_id: 'H256',
	},
	ComputeInfo: {
		cipher: 'CipherSuite',
		computer_indices: 'Vec<u32>',
		fees: 'u128',
		deadline: 'u64',
		confidentiality: 'ConfidentialityLevel',
		fee_function: 'Option<u8>',
		program_env: 'Option<Vec<u8>>',
		input: 'DAInput',
		program: 'DAInput',
		metadata: 'Option<ComputeMetadata>',
	},
	Contract: {
		contract_type: 'ContractType',
		guardians: 'Vec<AccountId>',
		pre_check: 'Option<ComputeInfo>',
		compute: 'ComputeInfo',
		post_check: 'Option<ComputeInfo>',
		result_cipher: 'CipherSuite'
	},
	AgreementInfo: {
		status: 'AgreementStatus',
		creator: 'AccountId',
		index: 'u32'
	},
    ComputePayload: {
		da_type: "u8",
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
	GuardianPrefs: {
		pubKey: "[u8; 32]",
		guardian: "bool",
		verifier: "bool",
		compute: "bool",
		computePrefs: "Option<ComputePrefs>",
		feeThreshold: "u128",
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
};

export const DEFAULT_COMPUTE_PAYLOAD =  { compute: { da_type: 0, verification: 0, compute: 0 } };
export const DEFAULT_EMPTY_PAYLOAD =  { compute: { da_type: 0, verification: 0, compute: 0, agreement: [] } };

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
};
