// import { CurveType } from '@noble/curves/abstract/bls';
import { bls12_381 as bls } from "@noble/curves/bls12-381";
import type { ProjPointType } from "@noble/curves/abstract/weierstrass";
import type { Fp, Fp12, Fp2 } from "@noble/curves/abstract/tower";

/**
 * Summary of porting the Silent Threshold encryption scheme from Rust to JavaScript.
 *
 * The Silent Threshold encryption scheme is a threshold encryption scheme that uses BLS12-381 as the underlying elliptic curve.
 * The scheme is based on the BLS signature scheme and uses the BLS pairing to encrypt and decrypt data.
 *
 * The types ported from the original Rust implementation are:
 * - E::ScalarField -> BigInt
 * - QuadExtField   -> Fp2
 * - CubicExtField  -> Fp6
 * - E::G1          -> ProjPointType<Fp>
 * - E::G2          -> ProjPointType<Fp2>
 * - PairingOutput  -> ProjPointType<Fp12>
 */

/**
 * @typedef {Object} PublicKey
 * @property {number} id - The identifier for the public key.
 * @property {ProjPointType<Fp>} bls_pk - The BLS public key.
 * @property {ProjPointType<Fp>} sk_li - The secret key component li.
 * @property {ProjPointType<Fp>} sk_li_minus0 - The secret key component li minus 0.
 * @property {ProjPointType<Fp>} sk_li_x - The secret key component li x.
 * @property {Array<ProjPointType<Fp>>} sk_li_lj_z - The secret key components li lj z.
 */
type PublicKey = {
	id: number;
	bls_pk: ProjPointType<Fp>;
	sk_li: ProjPointType<Fp>; //hint
	sk_li_minus0: ProjPointType<Fp>; //hint
	sk_li_lj_z: Array<ProjPointType<Fp>>; //hint
	sk_li_x: ProjPointType<Fp>; //hint
};

/**
 * @typedef {Object} LagrangePowers
 * @property {Array<CurveType>} li - The Lagrange coefficients li.
 * @property {Array<ProjPointType<Fp>>} li_minus0 - The Lagrange coefficients li minus 0.
 * @property {Array<ProjPointType<Fp>>} li_x - The Lagrange coefficients li x.
 * @property {Array<Array<ProjPointType<Fp>>>} li_lj_z - The Lagrange coefficients li lj z.
 */
type LagrangePowers = {
	// li: Array<CurveType>,
	li_minus0: Array<ProjPointType<Fp>>;
	li_x: Array<ProjPointType<Fp>>;
	li_lj_z: Array<Array<ProjPointType<Fp>>>;
};

/**
 * @typedef {ProjPointType<Fp12>} PairingOutput - The output of the pairing operation.
 */
type PairingOutput = ProjPointType<Fp12>;

/**
 * @typedef {Object} AggregateKey
 * @property {Array<PublicKey>} pk - The array of public keys.
 * @property {Array<ProjPointType<Fp>>} agg_sk_li_lj_z - The aggregated secret key components li lj z.
 * @property {ProjPointType<Fp>} ask - The aggregated secret key.
 * @property {ProjPointType<Fp2>} z_g2 - The z_g2 component.
 * @property {ProjPointType<Fp2>} h_minus1 - The h_minus1 component.
 * @property {PairingOutput} e_gh - The preprocessed pairing output.
 */
type AggregateKey = {
	pk: Array<PublicKey>;
	agg_sk_li_lj_z: Array<ProjPointType<Fp>>;
	ask: ProjPointType<Fp>;
	z_g2: ProjPointType<Fp2>;

	//preprocessed values
	h_minus1: ProjPointType<Fp2>;
	e_gh: Fp12;
};

/**
 * @typedef {Object} Ciphertext
 * @property {ProjPointType<Fp2>} gamma_g2 - The gamma_g2 component.
 * @property {Array<ProjPointType<Fp>>} sa1 - The sa1 components (2 elements).
 * @property {Array<ProjPointType<Fp2>>} sa2 - The sa2 components (6 elements).
 * @property {PairingOutput} enc_key - The encryption key.
 * @property {number} t - The threshold value.
 */
type Ciphertext = {
	gamma_g2: ProjPointType<Fp2>;
	sa1: ProjPointType<Fp>[];
	sa2: ProjPointType<Fp2>[];
	enc_key: Fp12; // key to be used for encapsulation
	t: number; // threshold
};

/**
 * @typedef {Object} PowersOfTau
 * @property {ArrayLike<ProjPointType<Fp>>} powers_of_g - The powers of g.
 * @property {ArrayLike<ProjPointType<Fp2>>} powers_of_h - The powers of h.
 */
type PowersOfTau = {
	powers_of_g: ArrayLike<ProjPointType<Fp>>;
	powers_of_h: ArrayLike<ProjPointType<Fp2>>;
};

/**
 * Encrypts data using the provided parameters and aggregate public key.
 *
 * @param params - The PowersOfTau parameters containing powers of g and h.
 * @param apk - The AggregateKey containing the aggregated public key and preprocessed values.
 * @param t - The threshold value for encryption.
 * @returns A Ciphertext object containing the encrypted data.
 */
const encrypt = (params: PowersOfTau, apk: AggregateKey, t: number) => {
	// Initialize an ArrayBuffer (tau) from a fixed string
	const gamma = bls.fields.Fr.create(
		BigInt(
			"0x" +
			reverseEndianess(
				"8660d3c2a2ab458dd6da04d3e7cb5cf6edb702dfa2fa0c952cd6f3bcdc0fdb1a",
			),
		),
	);
	// console.log(gamma.toString(16));
	// const gamma = bls.G1.normPrivateKeyToScalar(bls.utils.randomPrivateKey());
	const gamma_g2 = params.powers_of_h[0].multiply(gamma);
	// console.log(gamma_g2.toHex(true));

	let g = params.powers_of_g[0];
	let h = params.powers_of_h[0];

	let sa1 = [bls.G1.ProjectivePoint.BASE, bls.G1.ProjectivePoint.BASE];
	let sa2: ProjPointType<Fp2>[] = Array(6).fill(bls.G2.ProjectivePoint.BASE);
	// sa1.forEach((value, index) => {
	//     console.log(`sa1[${index}]: ${value.toHex(true)}`);
	// });
	// sa2.forEach((value, index) => {
	//     console.log(`sa2[${index}]: ${value.toHex(true)}`);
	// });

	const hexValues = [
		reverseEndianess(
			"08ca6f2a35f8f6f9cad58e9d764d450af154c246fc04266151e2a5493ff02943",
		),
		reverseEndianess(
			"8696a66087578b92e1b4b11c6b4c06d4694a9bed1f9468f0115e7f2648eb021d",
		),
		reverseEndianess(
			"91e201cc83dc03cc47d63cfb8a9016e73ffd1a78fffd14e4dfcdf2cbb9a7245d",
		),
		reverseEndianess(
			"a90598c6e0f25c3a104fc94632b1d58cf21bca3bbd7e41da07feb9c14e0fa60d",
		),
		reverseEndianess(
			"d3f5a9fc8abfef02fb6095c08ba4f3445b36f0fb963579bc5112d34a02044567",
		),
	];

	// let s = hexValues.map((hex) => bls.G1.normPrivateKeyToScalar(hex));
	// s.forEach((value, index) => {
	//     console.log(`s[${index}]: ${value.toString(16)}`);
	// });
	const s = Array.from({ length: 5 }, () => bls.G1.normPrivateKeyToScalar(bls.utils.randomPrivateKey()));

	// sa1[0] = s0*ask + s3*g^{tau^t} + s4*g
	sa1[0] = apk.ask
		.multiply(s[0])
		.add(params.powers_of_g[t].multiply(s[3]))
		.add(params.powers_of_g[0].multiply(s[4]));

	// sa1[1] = s2*g
	sa1[1] = g.multiply(s[2]);

	// sa2[0] = s0*h + s2*gamma_g2
	sa2[0] = h.multiply(s[0]).add(gamma_g2.multiply(s[2]));

	// sa2[1] = s0*z_g2
	sa2[1] = apk.z_g2.multiply(s[0]);

	// sa2[2] = s0*h^tau + s1*h^tau
	sa2[2] = params.powers_of_h[1]
		.multiply(s[0])
		.add(params.powers_of_h[1].multiply(s[1]));

	// sa2[3] = s1*h
	sa2[3] = h.multiply(s[1]);

	// sa2[4] = s3*h
	sa2[4] = h.multiply(s[3]);

	// sa2[5] = s4*h^{tau - omega^0}
	sa2[5] = params.powers_of_h[1].add(apk.h_minus1).multiply(s[4]);

	// enc_key = s4*e_gh
	const enc_key = bls.fields.Fp12.pow(apk.e_gh, s[4]);
	// const enc_key = apk.e_gh.multiply(s[4]);

	return { gamma_g2, sa1, sa2, enc_key, t };
};

/**
 * Decodes a hex string into a PowersOfTau object.
 *
 * @param input - The hex string to decode.
 * @returns A PowersOfTau object containing the decoded data.
 */
const decodePowersOfTau = (input: string): PowersOfTau => {
	try {
		// Ensure input is properly formatted
		if (!input || input.length % 2 !== 0) {
			throw new Error('Invalid input hex string');
		}

		// Convert hex string to Uint8Array
		const hexArray = input.match(/.{1,2}/g) || [];
		const buffer = new Uint8Array(hexArray.map(byte => parseInt(byte, 16)));

		// Create ArrayBuffer with the correct size
		const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
		const view = new DataView(arrayBuffer);

		const powers_of_g: Array<ProjPointType<Fp>> = [];
		const powers_of_h: Array<ProjPointType<Fp2>> = [];

		const G1_POINT_SIZE = 48; // 96/2 bytes for G1 points
		const G2_POINT_SIZE = 96; // 192/2 bytes for G2 points

		let offset = 0;

		// Read count safely
		if (offset + 8 > buffer.length) {
			throw new Error('Buffer too small to read count');
		}
		const count = view.getBigUint64(offset, true);
		offset += 8;

		// Read powers_of_g
		for (let i = 0; i < count; i++) {
			if (offset + G1_POINT_SIZE > buffer.length) {
				throw new Error('Buffer too small to read G1 point');
			}
			const pointBuffer = buffer.slice(offset, offset + G1_POINT_SIZE);
			const point = bls.G1.ProjectivePoint.fromHex(pointBuffer);
			powers_of_g.push(point);
			offset += G1_POINT_SIZE;
		}

		// Skip the second count
		if (offset + 8 > buffer.length) {
			throw new Error('Buffer too small to read second count');
		}
		offset += 8;

		// Read powers_of_h
		for (let i = 0; i < count; i++) {
			if (offset + G2_POINT_SIZE > buffer.length) {
				throw new Error('Buffer too small to read G2 point');
			}
			const pointBuffer = buffer.slice(offset, offset + G2_POINT_SIZE);
			const point = bls.G2.ProjectivePoint.fromHex(pointBuffer);
			powers_of_h.push(point);
			offset += G2_POINT_SIZE;
		}

		return { powers_of_g, powers_of_h };
	} catch (error) {
		console.error('Error in decodePowersOfTau:', error);
		console.log('Input length:', input.length);
		console.log('Input preview:', input.slice(0, 100));
		throw error;
	}
};

// Helper function to check if a hex string is valid
const isValidHex = (hex: string): boolean => {
	return /^[0-9A-Fa-f]*$/.test(hex) && hex.length % 2 === 0;
};

// Helper function to safely create a DataView from a hex string
const createDataViewFromHex = (hex: string): { view: DataView, buffer: Uint8Array } => {
	if (!isValidHex(hex)) {
		throw new Error('Invalid hex string');
	}
	const buffer = new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
	const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
	return {
		view: new DataView(arrayBuffer),
		buffer
	};
};

/**
 * Decodes a hex string into an AggregateKey object.
 *
 * @param input - The hex string to decode.
 * @returns An AggregateKey object containing the decoded data.
 */
const decodeAggregateKey = (input: string): AggregateKey => {
	const buffer = new Uint8Array(input.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
	let offset = 0;

	const view = new DataView(buffer.buffer);
	const readBigUInt64LE = () => {
		const value = view.getBigUint64(offset, true);
		offset += 8;
		return value;
	};

	const readProjPointTypeFp = (count: bigint) => {
		const points: Array<ProjPointType<Fp>> = [];
		for (let i = 0; i < count; i++) {
			const pointBuffer = buffer.slice(offset, offset + 48);
			const point = bls.G1.ProjectivePoint.fromHex(pointBuffer);
			points.push(point);
			offset += 48;
		}
		return points;
	};

	const readProjPointTypeFp2 = (count: bigint) => {
		const points: Array<ProjPointType<Fp2>> = [];
		for (let i = 0; i < count; i++) {
			const pointBuffer = buffer.slice(offset, offset + 96);
			const point = bls.G2.ProjectivePoint.fromHex(pointBuffer);
			points.push(point);
			offset += 96;
		}
		return points;
	};

	const readProjPointTypeFp12 = () => {
		const points: Array<Fp> = [];
		for (let i = 0; i < 12; i++) {
			const pointBuffer = buffer.slice(offset, offset + 48);
			// Convert to hex and reverse for endianness
			const hexValue = Array.from(pointBuffer)
				.reverse()
				.map(b => b.toString(16).padStart(2, '0'))
				.join('');
			const point = BigInt("0x" + hexValue);
			points.push(point);
			offset += 48;
		}
		if (points.length !== 12) {
			throw new Error("Invalid number of points for Fp12");
		}
		return bls.fields.Fp12.create({
			c0: bls.fields.Fp6.create({
				c0: bls.fields.Fp2.create({ c0: points[0], c1: points[1] }),
				c1: bls.fields.Fp2.create({ c0: points[2], c1: points[3] }),
				c2: bls.fields.Fp2.create({ c0: points[4], c1: points[5] }),
			}),
			c1: bls.fields.Fp6.create({
				c0: bls.fields.Fp2.create({ c0: points[6], c1: points[7] }),
				c1: bls.fields.Fp2.create({ c0: points[8], c1: points[9] }),
				c2: bls.fields.Fp2.create({ c0: points[10], c1: points[11] }),
			}),
		});
	};

	const pkCount = readBigUInt64LE();
	const pk: Array<PublicKey> = [];
	for (let i = 0; i < pkCount; i++) {
		const id = Number(readBigUInt64LE());
		const bls_pk = readProjPointTypeFp(BigInt(1))[0];
		const sk_li = readProjPointTypeFp(BigInt(1))[0];
		const sk_li_minus0 = readProjPointTypeFp(BigInt(1))[0];
		const sk_li_lj_z = readProjPointTypeFp(readBigUInt64LE());
		const sk_li_x = readProjPointTypeFp(BigInt(1))[0];
		pk.push({ id, bls_pk, sk_li, sk_li_minus0, sk_li_x, sk_li_lj_z });
	}

	const agg_sk_li_lj_z = readProjPointTypeFp(readBigUInt64LE());
	const ask = readProjPointTypeFp(BigInt(1))[0];
	const z_g2 = readProjPointTypeFp2(BigInt(1))[0];
	const h_minus1 = readProjPointTypeFp2(BigInt(1))[0];
	const e_gh = readProjPointTypeFp12();

	return { pk, agg_sk_li_lj_z, ask, z_g2, h_minus1, e_gh };
};

/**
 * Encode a Ciphertext object into a hex string.
 *
 * @param input - The Ciphertext object to encode.
 * @returns A hex string containing the encoded data.
 */
const encodeCiphertext = (input: Ciphertext): string => {
	const writeProjPointTypeFp = (point: ProjPointType<Fp>) => {
		const hex = point.toHex(true);
		return new Uint8Array(hex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
	};

	const writeProjPointTypeFp2 = (point: ProjPointType<Fp2>) => {
		const hex = point.toHex(true);
		return new Uint8Array(hex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
	};

	const gamma_g2Buffer = writeProjPointTypeFp2(input.gamma_g2);
	const sa1Buffer = new Uint8Array(input.sa1.flatMap(p => Array.from(writeProjPointTypeFp(p))));
	const sa2Buffer = new Uint8Array(input.sa2.flatMap(p => Array.from(writeProjPointTypeFp2(p))));
	const enc_keyBuffer = new Uint8Array(fp12ToHex(input.enc_key).match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);

	const tBuffer = new Uint8Array(8);
	new DataView(tBuffer.buffer).setBigUint64(0, BigInt(input.t), true);

	const totalLength = gamma_g2Buffer.length + sa1Buffer.length + sa2Buffer.length + enc_keyBuffer.length + tBuffer.length;
	const resultBuffer = new Uint8Array(totalLength);

	let offset = 0;
	resultBuffer.set(gamma_g2Buffer, offset);
	offset += gamma_g2Buffer.length;
	resultBuffer.set(sa1Buffer, offset);
	offset += sa1Buffer.length;
	resultBuffer.set(sa2Buffer, offset);
	offset += sa2Buffer.length;
	resultBuffer.set(enc_keyBuffer, offset);
	offset += enc_keyBuffer.length;
	resultBuffer.set(tBuffer, offset);

	return Array.from(resultBuffer)
		.map(b => b.toString(16).padStart(2, '0'))
		.join('');
};

function demoFieldOperations() {
	// Create base points in G1 and G2
	const g1Base = bls.G1.ProjectivePoint.BASE;
	const g2Base = bls.G2.ProjectivePoint.BASE;
	console.log("G1 generator: ", g1Base.toHex(true));
	console.log("G2 generator: ", g2Base.toHex(true));

	const scalar = bls.fields.Fr.create(
		BigInt(
			"0x1d8a77a2bc0faf4c4c904eed119108ed9b375265f7d06cec6862a2a97c3adb27",
		),
	);
	console.log("Scalar: ", scalar.toString(16));

	const e_ghH = bls.pairing(g1Base, g2Base);
	console.log(fp12ToHex(e_ghH));
	// return

	// Perform G1 addition
	const g1Sum = g1Base.add(g1Base);
	console.log("G1 generator doubled: ", g1Sum.toHex(true));

	// Perform G2 addition
	const g2Sum = g2Base.add(g2Base);
	console.log("G2 generator doubled: ", g2Sum.toHex(true));

	// Create an Fp element and do multiplication
	const fp_a = bls.fields.Fp.create(
		BigInt(
			"0xa191b705ef18a6e4e5bd4cc56de0b8f94b1f3c908f3e3fcbd4d1dc12eb85059be7e7d801edc1856c8cfbe6d63a681c1f",
		),
	);
	const fp_b = bls.fields.Fp.create(
		BigInt(
			"0x8e07730c0dceb35342bfa587940babad2ec7622aec96994179086a5d323c479e64c890939e47f9a46b427f063f71d4f4",
		),
	);
	const fpModified = bls.fields.Fp.addN(fp_a, fp_b);
	console.log("Fp a + b: ", fpModified.toString(16));

	const g1_a = bls.G1.ProjectivePoint.fromHex(
		"a191b705ef18a6e4e5bd4cc56de0b8f94b1f3c908f3e3fcbd4d1dc12eb85059be7e7d801edc1856c8cfbe6d63a681c1f",
	);
	const g1_b = bls.G1.ProjectivePoint.fromHex(
		"8e07730c0dceb35342bfa587940babad2ec7622aec96994179086a5d323c479e64c890939e47f9a46b427f063f71d4f4",
	);
	const g1_zero = bls.G1.ProjectivePoint.ZERO;
	console.log("G1 a: ", g1_a.toHex(true));
	console.log("G1 b: ", g1_b.toHex(true));
	console.log("G1 zero: ", g1_zero.toHex(true));

	const g1_sum = g1_a.add(g1_b);
	const g1_sub = g1_a.subtract(g1_b);
	const g1_neg = g1_a.negate();
	const g1_dbl = g1_a.double();
	const g1_scalar_mul = g1_a.multiply(scalar);
	console.log("G1 a + b: ", g1_sum.toHex(true));
	console.log("G1 a - b: ", g1_sub.toHex(true));
	console.log("G1 -a: ", g1_neg.toHex(true));
	console.log("G1 2a: ", g1_dbl.toHex(true));
	console.log("G1 scalar mul: ", g1_scalar_mul.toHex(true));

	// Create an Fp2 element and do multiplication
	const fp2_a = bls.fields.Fp2.create({
		c0: BigInt(
			"0x848e9f7ae435bd738c33ae1f11cefb472b29a090de5ce00740b8ec1bd30fdbb27eb7e65162eed68c55e0bb03bf749857",
		),
		c1: BigInt(
			"0x0f8faa02f0dd3225ca98d8306f8efa4e3f62a13efc342f3466d3e56be5144dae68cafab0f99ddf1f04a6659806b12235",
		),
	});
	const fp2_b = bls.fields.Fp2.create({
		c0: BigInt(
			"0xa4d21fc0921dcca8f0666f3b7530b569c2309bc13d3303a6fc3d233c58275972879c415608b6774bbbb00e10a6e47ace",
		),
		c1: BigInt(
			"0x1046aa2e6208f5d1813de823e5e3dec638bb7b82247cebeebbc70a14f1f59b9c0738b0f08120cb81d8c876579bd2391f",
		),
	});
	const fp2Modified = bls.fields.Fp2.addN(fp2_a, fp2_b);
	console.log(
		"Fp2 a + b: ",
		fp2Modified.c0.toString(16),
		fp2Modified.c1.toString(16),
	);

	const g2_a = bls.G2.ProjectivePoint.fromHex(
		"848e9f7ae435bd738c33ae1f11cefb472b29a090de5ce00740b8ec1bd30fdbb27eb7e65162eed68c55e0bb03bf7498570f8faa02f0dd3225ca98d8306f8efa4e3f62a13efc342f3466d3e56be5144dae68cafab0f99ddf1f04a6659806b12235",
	);
	const g2_b = bls.G2.ProjectivePoint.fromHex(
		"a4d21fc0921dcca8f0666f3b7530b569c2309bc13d3303a6fc3d233c58275972879c415608b6774bbbb00e10a6e47ace1046aa2e6208f5d1813de823e5e3dec638bb7b82247cebeebbc70a14f1f59b9c0738b0f08120cb81d8c876579bd2391f",
	);
	const g2_zero = bls.G2.ProjectivePoint.ZERO;
	console.log("G2 a: ", g2_a.toHex(true));
	console.log("G2 b: ", g2_b.toHex(true));
	console.log("G2 zero: ", g2_zero.toHex(true));

	const g2_sum = g2_a.add(g2_b);
	const g2_sub = g2_a.subtract(g2_b);
	const g2_neg = g2_a.negate();
	const g2_dbl = g2_a.double();
	const g2_scalar_mul = g2_a.multiply(scalar);
	console.log("G2 a + b: ", g2_sum.toHex(true));
	console.log("G2 a - b: ", g2_sub.toHex(true));
	console.log("G2 -a: ", g2_neg.toHex(true));
	console.log("G2 2a: ", g2_dbl.toHex(true));
	console.log("G2 scalar mul: ", g2_scalar_mul.toHex(true));

	// Create an Fp12 element and do squaring
	const fp12_a = hexToFp12(
		"7b41018107fbe009aeb2ae912921bb2145b658bff588daea81a2d53a8c4aee171935fcc96fb395398ae4e4b20d937e16967f5e6a543f14a6751a869bfd22c8d96857389065eb86aa6784483efafc422ddb530f3dd76b3ce620605f6e21ee8c13f0a6b6f84a6ab78fdc1167e447c4f3a1d7cc51cf686646b7b31199d3e453c009ca949eb79696bf3d64c68a92e66fcc1514605dea849d01626006d806aca856a641993f84d2c620e6c97f4d8773c7664baee35761c576f687d6a643c3c6257b07f1f07ec6b0eb29ebaa9cb4088b29db25d2612fa604c96b3d148f0f8a954a0777b6e21f4b51f69530401651d1d0c9480ff23d5c0c0d34ede48be9c08dd6bbee77015deddac23d10eebd64ff1ecbce86a696f051fabe6c26e15e3b946afcc2b613f0b3a2126b6533792284bc5fc90a899c4c3a05b2491ce6903a9b2d85f30d630f421324492cbbbaf174cdc1a29adc110bb4891940fa9e8ad79520296819a6b6a32a578f7283c44d9c45e0c2676e0bbb4522cbdc23baebfa3cb008f43700a67207d7eb10a9d82cc576cbe3e10bac5e23613d456c18a512180869f48b52117c8dd1de9ce4728737d3239cfe829ccea8740e42c737ff961d5cff8d9ca0da3434ed909a3d362411cdb5c8e1bc917913c3cd783c3974621309d255f81c06e46132e0076209171b0ffea3ed0541e03d78856c018912927c520c56af071062972d1cb07276d8dcea9746000dbca97f78060e1815d22f5f88652aa53ae1664e449457c2e700e65efdaff38ac0a7849f4966411153dfd1befa7bab0d1889cc643e82809911",
	);
	const fp12_b = hexToFp12(
		"d9b0619e9e724685d2eb06d509523870f9dfe07c7d7fb623632fc8f3ef8acd66fd9ed31a79af676ac1c2adc48ff018066f12bda4c5b225652d002ccba86315d57ebf098d35f3987a0b79f4d989c09c0c6373e58ac42c24e5a3b16d3eafa3e91020f0bfea83f3f1736732e71aac76e40399ec881a62a93426306be1e9dfc6645f1649a1d26d7d1ada5aca07c57551250749995a15db818c0aa7acb4606e7f41b65375308abbd547f7b8d90f10e1a7bfba60924a451108c8b896efa7355e14af10c096bb64e70e0c055e27e79b3b7552aa0b36bd3eace4759e13a31eabaea322bf978d2815b287e7c4d31281c85898090b57af368ceefe8be408504a0d57c542ad8e73f44211df17c89a2fd099f25895615828c884d9c31e514819d63856841601cce68807457db323e23db4bbc9a80900fb19aafd655069700db1b5d5a5753adedab2bd556fdc1774a54f0733a51e3c18f16e700f87ade824f35dde86023a5b7d816031e0eac3c4d82a80637a777969815fbd3ddcfcaf77ed7d9ad7c8c886530414d76c34808efefd57b488b065319f573a4ac806eb5da273c4320301ca6de6c682cd844f0a08c9b5e86f29431c32830d1feedf4d8bcd5d5ca90ef15084fffb98abe683d36e9de474ed069e8f72f4cdc7043cd38cb59878acef0674d0b48b8f0b9a0df326c8c7e97a5f35dcc1377f2e68d2e6076afb792db5ad38cb01158571e0c8b644e77c8d1b574653dcd73941070cd34deac7afe916952d3b67b4ad3e8993b33308c282de58e37afb28ae2afbb44f8e56b2e3ef575b67c5bc3112ccfedd07",
	);
	const fp12_zero = bls.fields.Fp12.ZERO;
	const fp12_one = bls.fields.Fp12.ONE;
	const fp12_pairing = bls.pairing(g1_a, g2_b);
	const fp12_scalar_mul = bls.fields.Fp12.pow(fp12_pairing, scalar);

	console.log("Fp12 a:", fp12ToHex(fp12_a));
	console.log("Fp12 b:", fp12ToHex(fp12_b));
	console.log("Fp12 zero:", fp12ToHex(fp12_zero));
	console.log("Fp12 one:", fp12ToHex(fp12_one));
	console.log("Fp12 pairing:", fp12ToHex(fp12_pairing));
	console.log("Fp12 scalar mul:", fp12ToHex(fp12_scalar_mul));

	const fp12_add = bls.fields.Fp12.add(fp12_a, fp12_b);
	const fp12_sub = bls.fields.Fp12.sub(fp12_a, fp12_b);
	const fp12_neg = bls.fields.Fp12.neg(fp12_a);
	const fp12_mul = bls.fields.Fp12.mul(fp12_a, fp12_b);
	const fp12_inv = bls.fields.Fp12.inv(fp12_a);

	console.log("Fp12 add:", fp12ToHex(fp12_add));
	console.log("Fp12 sub:", fp12ToHex(fp12_sub));
	console.log("Fp12 neg:", fp12ToHex(fp12_neg));
	console.log("Fp12 mul:", fp12ToHex(fp12_mul));
	console.log("Fp12 inv:", fp12ToHex(fp12_inv));
}

function hexToFp12(hex: string): Fp12 {
	const c0 = bls.fields.Fp6.create({
		c0: bls.fields.Fp2.create({
			c0: BigInt("0x" + reverseEndianess(hex.slice(0, 96))),
			c1: BigInt("0x" + reverseEndianess(hex.slice(96, 192))),
		}),
		c1: bls.fields.Fp2.create({
			c0: BigInt("0x" + reverseEndianess(hex.slice(192, 288))),
			c1: BigInt("0x" + reverseEndianess(hex.slice(288, 384))),
		}),
		c2: bls.fields.Fp2.create({
			c0: BigInt("0x" + reverseEndianess(hex.slice(384, 480))),
			c1: BigInt("0x" + reverseEndianess(hex.slice(480, 576))),
		}),
	});
	const c1 = bls.fields.Fp6.create({
		c0: bls.fields.Fp2.create({
			c0: BigInt("0x" + reverseEndianess(hex.slice(576, 672))),
			c1: BigInt("0x" + reverseEndianess(hex.slice(672, 768))),
		}),
		c1: bls.fields.Fp2.create({
			c0: BigInt("0x" + reverseEndianess(hex.slice(768, 864))),
			c1: BigInt("0x" + reverseEndianess(hex.slice(864, 960))),
		}),
		c2: bls.fields.Fp2.create({
			c0: BigInt("0x" + reverseEndianess(hex.slice(960, 1056))),
			c1: BigInt("0x" + reverseEndianess(hex.slice(1056, 1152))),
		}),
	});
	return bls.fields.Fp12.create({ c0, c1 });
}

function convertToCyclotomic(fp12: Fp12): Fp12 {
	const p = BigInt(
		"0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab",
	); // BLS12-381 prime
	const exponent = p ** BigInt(4) - p ** BigInt(2) + BigInt(1);
	return bls.fields.Fp12.pow(fp12, exponent);
}

function fp12ToHex(fp12: Fp12): string {
	const c0 = fp12.c0;
	const c1 = fp12.c1;
	return [
		bigintToBigEndianHex(c0.c0.c0, 48),
		bigintToBigEndianHex(c0.c0.c1, 48),
		bigintToBigEndianHex(c0.c1.c0, 48),
		bigintToBigEndianHex(c0.c1.c1, 48),
		bigintToBigEndianHex(c0.c2.c0, 48),
		bigintToBigEndianHex(c0.c2.c1, 48),
		bigintToBigEndianHex(c1.c0.c0, 48),
		bigintToBigEndianHex(c1.c0.c1, 48),
		bigintToBigEndianHex(c1.c1.c0, 48),
		bigintToBigEndianHex(c1.c1.c1, 48),
		bigintToBigEndianHex(c1.c2.c0, 48),
		bigintToBigEndianHex(c1.c2.c1, 48),
	].join("");
}

const testCrypt = (
	kzg: string,
	agg_key: string,
): { encoded: string; ikm: string; ciph: Ciphertext } => {
	try {
		// Validate inputs
		if (!isValidHex(kzg) || !isValidHex(agg_key)) {
			throw new Error('Invalid input hex strings');
		}

		const powersOfTau = decodePowersOfTau(kzg);
		const aggregateKey = decodeAggregateKey(agg_key);

		const ciph = encrypt(powersOfTau, aggregateKey, 2);
		const encoded = encodeCiphertext(ciph);
		const ikm = fp12ToHex(ciph.enc_key);

		return { encoded, ikm, ciph };
	} catch (error) {
		console.error('Error in testCrypt:', error);
		throw error;
	}
};

function bigintToBigEndianHex(value: bigint, length: number): string {
	// Convert BigInt to hex string without the '0x' prefix
	let hex = value.toString(16);

	// Ensure the hex string is padded to the desired length
	if (hex.length > length * 2) {
		throw new Error("BigInt value is too large to fit in the specified length");
	}

	// Pad the hex string with leading zeros
	hex = hex.padStart(length * 2, "0");

	// Convert the hex string to a byte array
	const byteArray =
		hex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [];

	// Reverse the byte array to get big-endian format
	const reversedByteArray = byteArray.reverse();

	// Convert the reversed byte array back to a hex string
	const bigEndianHex = reversedByteArray
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");

	return bigEndianHex;
}

function reverseEndianess(hex: string): string {
	if (hex.length % 2 !== 0) {
		throw new Error("Hex string must have an even length");
	}
	return hex.match(/.{1,2}/g)?.reverse().join('') || '';
}

export {
	decodeAggregateKey,
	decodePowersOfTau,
	encodeCiphertext,
	encrypt as ecncryptTest,
	testCrypt,
};
