/** @format */

const express = require("express");
const puppeteer = require("puppeteer");
const fs = require("fs-extra");
const hbs = require("handlebars");
const path = require("path");
const moment = require("moment");
const cors = require("cors");
const app = express();
const SSLCommerzPayment = require("sslcommerz-lts");
require("dotenv").config();

const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nvffntx.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
	serverApi: {
		version: ServerApiVersion.v1,
		strict: true,
		deprecationErrors: true,
	},
});

const store_id = process.env.VITE_STORE_ID;
const store_passwd = process.env.VITE_STORE_PASS;
const is_live = false; //true for live, false for sandbox
async function run() {
	try {
		// Connect the client to the server	(optional starting in v4.7)
		await client.connect();

		const onGoingBusCollections = client
			.db("e-Ticket_booking")
			.collection("toDaysBusQue");
		const busOperatorsCollections = client
			.db("e-Ticket_booking")
			.collection("busOperators");

		const allBusInfoCollections = client
			.db("e-Ticket_booking")
			.collection("allBusInfo");
		const userCollection = client
			.db("e-Ticket_booking")
			.collection("userCollection");
		const busReservedDate = client
			.db("e-Ticket_booking")
			.collection("busReservedDate");
		const paymentCollection = client
			.db("e-Ticket_booking")
			.collection("payment");

		app.get("/on_going_bus", async (req, res) => {
			const fromCity = req.query.fromCity;
			const toCity = req.query.toCity;
			const doj = req.query.doj;

			const query = {
				startingPoint: fromCity,
				endingPoint: toCity,
				journeyDate: doj,
			};

			const result = await onGoingBusCollections.find(query).toArray();

			res.send(result);
		});

		app.get("/single-on-going-bus", async (req, res) => {
			const busNumber = req.query.busNumber;
			const result = await onGoingBusCollections.findOne({ busNumber });
			res.send(result);
		});

		app.get("/get-all-bus-operators", async (req, res) => {
			const busOperator = await busOperatorsCollections.find().toArray();

			res.send(busOperator);
		});

		app.get("/get-bus-number", async (req, res) => {
			const busOperatorName = req?.query?.operatorName;
			const journeyDate = req?.query?.journeyDate;

			if (busOperatorName && journeyDate) {
				const busNumber = await busReservedDate
					.find({
						$and: [
							{ busOperatorName },
							{ journeyDate: { $nin: [journeyDate] } },
						],
					})
					.toArray();

				res.send(busNumber);
			}
		});

		app.get("/get-all-bus-operator", async (req, res) => {
			const busOperatorName = req.query.busOperatorName;
			const businessReg = req.query.businessReg;
			const isApproved = req.query.isApproved;

			let busList = [];
			if (isApproved) {
				const allBusList = await allBusInfoCollections
					.find({
						$and: [
							{ busOperatorName },
							{ businessReg },
							{ isApproved: JSON.parse(isApproved) },
						],
					})
					.toArray();

				busList = [...allBusList];
			} else {
				const allBusList = await allBusInfoCollections
					.find({
						$and: [{ busOperatorName }, { businessReg }],
					})
					.toArray();
				busList = [...allBusList];
			}
			const totalBus = await allBusInfoCollections.countDocuments({
				$and: [{ busOperatorName }, { businessReg }],
			});
			const pendingBus = await allBusInfoCollections.countDocuments({
				$and: [
					{ isApproved: false },
					{ busOperatorName },
					{ businessReg },
				],
			});
			const approvedBus = await allBusInfoCollections.countDocuments({
				$and: [
					{ isApproved: true },
					{ busOperatorName },
					{ businessReg },
				],
			});

			res.send({ busList, totalBus, pendingBus, approvedBus });
		});

		app.get("/get-bus-by-status", async (req, res) => {
			const isApproved = req.query.isApproved;

			const result = await allBusInfoCollections
				.find({
					isApproved: JSON.parse(isApproved),
				})
				.toArray();

			res.send(result);
		});

		// set bus deule for admin
		app.post("/set-bus-on-sedule", async (req, res) => {
			const busInfo = req.body;
			const extraInfo = await allBusInfoCollections.findOne({
				busNumber: busInfo?.busNumber,
			});

			const newBusSedule = {
				...busInfo,
				...Object.entries(extraInfo).reduce((acc, [key, value]) => {
					if (key !== "_id") {
						acc[key] = value;
					}
					return acc;
				}, {}),
				bookedSits: 0,
				bookedSitsNumber: [],
			};
			const addNewBusOnSedule = await onGoingBusCollections.insertOne(
				newBusSedule
			);

			const query = {
				$and: [
					{ busOperatorName: busInfo?.busOperatorName },
					{ busNumber: busInfo?.busNumber },
				],
			};
			const addJournyDate = await busReservedDate.updateOne(query, {
				$push: {
					journeyDate: busInfo?.journeyDate,
				},
			});

			res.send(addNewBusOnSedule);
		});

		app.post("/add-new-bus", async (req, res) => {
			const body = req.body;
			const userInfo = await userCollection.findOne({
				$and: [
					{ busOperatorName: body?.busOperatorName },
					{
						businessReg: body?.businessReg,
					},
				],
			});
			const isExistBus = await allBusInfoCollections.findOne({
				$and: [
					{ busNumber: body?.busNumber }, // Check if busNumber matches
					{ busOperatorName: body?.busOperatorName }, // Check if busOperatorName matches
				],
			});

			if (isExistBus) {
				return res.send({
					message: "The Bus Already Exist",
				});
			} else {
				const insertNewBus = await allBusInfoCollections.insertOne({
					...body,
					busOperatorPhoneNumber: userInfo?.busOperatorPhoneNumber,
					busOperatorAddress: userInfo?.busOperatorAddress,
					rent: parseInt(body.rent),
					totalSits: parseInt(body.totalSits),
					isApproved: false,
				});

				res.send(insertNewBus);
			}
		});

		app.patch("/accept-bus-request", async (req, res) => {
			const id = req.query.id;

			const query = {
				_id: new ObjectId(id),
			};
			const getPendingBus = await allBusInfoCollections.findOne(query);

			if (getPendingBus) {
				const updateDoc = {
					$set: {
						isApproved: true,
					},
				};
				const result = await allBusInfoCollections.updateOne(
					query,
					updateDoc
				);

				const operatorDocument = await busReservedDate.findOne({
					busNumber: getPendingBus?.busNumber,
				});

				if (!operatorDocument) {
					const insertDoc = {
						busNumber: getPendingBus?.busNumber,
						busOperatorName: getPendingBus?.busOperatorName,
						businessReg: getPendingBus?.businessReg,
						journeyDate: [],
					};

					const operatorDocument = await busReservedDate.insertOne(
						insertDoc
					);
					res.send(operatorDocument);
				}
				
		});

		app.post("/create-user", async (req, res) => {
			const {
				email,
				name,
				businessReg,
				busOperatorName,
				busOperatorPhoneNumber,
				busOperatorAddress,
				role,
			} = req.body;

			const isExist = await userCollection.findOne({
				$or: [
					{ email }, // Check if email matches
					{ businessReg }, // Check if businessReg matches
					{ busOperatorName }, // Check if busOperatorName matches
				],
			});

			const isBusOperatorExist = await busOperatorsCollections.findOne({
				businessReg,
			});

			if (isExist && isBusOperatorExist) {
				return res.send({
					message: "user already exist",
				});
			} else if (!isExist && isBusOperatorExist) {
				const insertNewUser = await userCollection.insertOne({
					email,
					name,
					businessReg,
					busOperatorName,
					busOperatorPhoneNumber,
					busOperatorAddress,
					role,
				});

				res.send(insertNewUser);
			} else if (isExist && !isBusOperatorExist) {
				const inserTBusOperator =
					await busOperatorsCollections.insertOne({
						busOperatorName,
						businessReg,
					});

				res.send(inserTBusOperator);
			} else {
				const insertNewUser = await userCollection.insertOne({
					email,
					name,
					businessReg,
					busOperatorName,
					busOperatorPhoneNumber,
					busOperatorAddress,
					role,
				});
				const inserTBusOperator =
					await busOperatorsCollections.insertOne({
						busOperatorName,
						businessReg,
					});

				res.send({ insertNewUser, inserTBusOperator });
			}
		});

		app.get("/get-user", async (req, res) => {
			const email = req.query.email;
			const getUser = await userCollection.findOne({ email });

			res.send(getUser);
		});

		// payment
		app.post("/order", async (req, res) => {
			const {
				passengerInfo,
				passengerEmail,
				passengerMobileNo,
				isSecure,
				totalAmount,
				startingPoint,
				endingPoint,
				journeyDate,
				startingTime,
				busOperatorName,
				busOperatorAddress,
				busOperatorEmail,
				busOperatorPhoneNumber,
				isAC,
				busNumber,
				paymentDate,
			} = req.body;

			const tran_id = new ObjectId().toString();

			const data = {
				total_amount: totalAmount,
				currency: "BDT",
				tran_id: tran_id, // use unique tran_id for each api call
				success_url: `https://ticket-booking-server-mgrakib.vercel.app/payment/success/${tran_id}`,
				fail_url: `https://ticket-booking-server-mgrakib.vercel.app/payment/failed/${tran_id}`,
				cancel_url: "http://localhost:3030/cancel",
				ipn_url: "http://localhost:3030/ipn",
				shipping_method: "Courier",
				product_name: "Computer.",
				product_category: "Electronic",
				product_profile: "general",
				cus_name: "Customer Name",
				cus_email: passengerEmail,
				cus_add1: "Dhaka",
				cus_add2: "Dhaka",
				cus_city: "Dhaka",
				cus_state: "Dhaka",
				cus_postcode: "1000",
				cus_country: "Bangladesh",
				cus_phone: passengerMobileNo,
				cus_fax: "01711111111",
				ship_name: "Customer Name",
				ship_add1: "Dhaka",
				ship_add2: "Dhaka",
				ship_city: "Dhaka",
				ship_state: "Dhaka",
				ship_postcode: 1000,
				ship_country: "Bangladesh",
			};
			const sslcz = new SSLCommerzPayment(
				store_id,
				store_passwd,
				is_live
			);
			sslcz.init(data).then(apiResponse => {
				// Redirect the user to payment gateway
				let GatewayPageURL = apiResponse.GatewayPageURL;
				console.log(GatewayPageURL);
				res.send({ url: GatewayPageURL });

				const finalPayment = {
					paid: false,
					tran_id,
					passengerInfo,
					passengerEmail,
					passengerMobileNo,
					isSecure,
					totalAmount,
					startingPoint,
					endingPoint,
					journeyDate,
					startingTime,
					busOperatorName,
					busOperatorAddress,
					busOperatorEmail,
					busOperatorPhoneNumber,
					isAC,
					busNumber,
					paymentDate,
				};
				const result = paymentCollection.insertOne(finalPayment);
			});

			app.post("/payment/success/:tran", async (req, res) => {
				const getTotalNumberOfPayment =
					await paymentCollection.countDocuments();

				const updateStatus = await paymentCollection.updateOne(
					{ tran_id: req.params.tran },
					{
						$set: {
							paid: true,
							invoiceNumber: `E-TB97${getTotalNumberOfPayment}`,
						},
					}
				);

				const bookedSeats = passengerInfo.map(seat => seat.seat);

				if (updateStatus.modifiedCount > 0) {
					const booking = await onGoingBusCollections.findOne({
						busOperatorName,
						journeyDate,
						busNumber,
					});

					if (booking) {
						booking.bookedSitsNumber = [
							...bookedSeats,
							...booking.bookedSitsNumber,
						];
					}

					await onGoingBusCollections.updateOne(
						{ _id: booking._id },
						{ $set: booking }
					);

					// TODO: change the mail link
					res.redirect(
						`http://localhost:5173/payment-successfull/${tran_id}`
					);
				}
			});

			app.post("/payment/failed/:tran", async (req, res) => {
				const tran_id = req.params.tran;
				const result = await paymentCollection.deleteOne({
					tran_id,
				});

				res.redirect("http://localhost:5173/payment-failed");
			});
		});

		app.get("/get-payment-history", async (req, res) => {
			const tran_id = req.query.tran_id;
			const paymentHistory = await paymentCollection.findOne({ tran_id });
			res.send(paymentHistory);
		});

		app.get("/payment-history-by-invoice_mobile", async (req, res) => {
			const invoiceNumber = req.query.invoiceNumber;
			const passengerMobileNo = req.query.passengerMobileNo;

			console.log(invoiceNumber, passengerMobileNo);
			const paymentHistory = await paymentCollection.findOne({
				$and: [{ invoiceNumber }, { passengerMobileNo }],
			});

			console.log(paymentHistory);
			res.send(paymentHistory);
		});

		app.get("/get-bus-station", async (req, res) => {
			const result = await busStationName
				.find({ busStationName: true })
				.toArray();
			const stationName = result?.[0]?.districts;
			res.send(stationName);
		});


		// generate pdf 

		const compailer = async function (tamplateName, data) {
			const fileName = path.join(
				process.cwd(),
				"templates",
				`${tamplateName}.hbs`
			);
			const html = await fs.readFile(fileName, "utf-8");
			return hbs.compile(html)(data);
		};

		hbs.registerHelper(
			"dateFormatestartingTime",
			function (value, formate) {
				return moment(value, "HH:mm")
					.subtract(30, "minutes")
					.format(formate);
			}
		);
		hbs.registerHelper("dateFormate", function (value, formate) {
			return moment(value, "HH:mm").format(formate);
		});


		app.post("/generate-ticket-pdf", async (req, res) => {
			const tran_id = req.query.tran_id;
			const paymentInfo = await paymentCollection.findOne({
				tran_id,
			});
			
			const browser = await puppeteer.launch({
				headless: true,
			});
			const page = await browser.newPage();
			const content = await compailer("ticket", paymentInfo);
			await page.setContent(content);
			const pdfBuffer = await page.pdf({
				format: "A4",
				printBackground: true,
			});

			await browser.close();

			res.setHeader(
				"Content-Disposition",
				"attachment; filename=ticket.pdf"
			);
			res.setHeader("Content-Type", "application/pdf");

			// Send the PDF as the response
			res.send(pdfBuffer);
		});

		// Send a ping to confirm a successful connection
		await client.db("admin").command({ ping: 1 });
		console.log(
			"Pinged your deployment. You successfully connected to MongoDB!"
		);
	} finally {
		// Ensures that the client will close when you finish/error
		// await client.close();
	}
}
run().catch(console.dir);

app.get("/", (req, res) => {
	res.send("e-Ticket-Booking Server running...");
});

app.listen(port, () => {
	console.log(`Example app listening on port ${port}`);
});
