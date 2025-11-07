pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EnergyTradingMarket is ZamaEthereumConfig {
    struct EnergyListing {
        address owner;
        euint32 encryptedEnergyAmount;
        uint256 pricePerUnit;
        uint256 timestamp;
        bool isActive;
        uint32 decryptedEnergyAmount;
        bool isDecrypted;
    }

    struct TradeAgreement {
        address buyer;
        address seller;
        uint256 price;
        uint256 timestamp;
        bool isSettled;
    }

    mapping(uint256 => EnergyListing) public energyListings;
    mapping(uint256 => TradeAgreement) public tradeAgreements;
    mapping(address => uint256) public balances;

    uint256 public nextListingId = 1;
    uint256 public nextTradeId = 1;

    event EnergyListed(uint256 indexed listingId, address indexed owner, uint256 pricePerUnit);
    event EnergyDecrypted(uint256 indexed listingId, uint32 decryptedEnergyAmount);
    event TradeInitiated(uint256 indexed tradeId, uint256 indexed listingId, address indexed buyer, address seller, uint256 price);
    event TradeSettled(uint256 indexed tradeId);

    constructor() ZamaEthereumConfig() {
    }

    function listEnergy(
        externalEuint32 encryptedEnergyAmount,
        bytes calldata inputProof,
        uint256 pricePerUnit
    ) external {
        require(pricePerUnit > 0, "Price must be positive");
        require(FHE.isInitialized(FHE.fromExternal(encryptedEnergyAmount, inputProof)), "Invalid encrypted input");

        uint256 listingId = nextListingId++;
        energyListings[listingId] = EnergyListing({
            owner: msg.sender,
            encryptedEnergyAmount: FHE.fromExternal(encryptedEnergyAmount, inputProof),
            pricePerUnit: pricePerUnit,
            timestamp: block.timestamp,
            isActive: true,
            decryptedEnergyAmount: 0,
            isDecrypted: false
        });

        FHE.allowThis(energyListings[listingId].encryptedEnergyAmount);
        FHE.makePubliclyDecryptable(energyListings[listingId].encryptedEnergyAmount);

        emit EnergyListed(listingId, msg.sender, pricePerUnit);
    }

    function decryptEnergy(
        uint256 listingId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(listingId < nextListingId, "Invalid listing ID");
        require(!energyListings[listingId].isDecrypted, "Energy already decrypted");
        require(energyListings[listingId].isActive, "Listing is inactive");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(energyListings[listingId].encryptedEnergyAmount);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        energyListings[listingId].decryptedEnergyAmount = decodedValue;
        energyListings[listingId].isDecrypted = true;

        emit EnergyDecrypted(listingId, decodedValue);
    }

    function initiateTrade(uint256 listingId) external payable {
        require(listingId < nextListingId, "Invalid listing ID");
        require(energyListings[listingId].isActive, "Listing is inactive");
        require(energyListings[listingId].isDecrypted, "Energy not decrypted");
        require(msg.value >= energyListings[listingId].decryptedEnergyAmount * energyListings[listingId].pricePerUnit, "Insufficient payment");

        uint256 tradeId = nextTradeId++;
        uint256 totalAmount = energyListings[listingId].decryptedEnergyAmount * energyListings[listingId].pricePerUnit;

        tradeAgreements[tradeId] = TradeAgreement({
            buyer: msg.sender,
            seller: energyListings[listingId].owner,
            price: totalAmount,
            timestamp: block.timestamp,
            isSettled: false
        });

        energyListings[listingId].isActive = false;

        emit TradeInitiated(tradeId, listingId, msg.sender, energyListings[listingId].owner, totalAmount);
    }

    function settleTrade(uint256 tradeId) external {
        require(tradeId < nextTradeId, "Invalid trade ID");
        require(!tradeAgreements[tradeId].isSettled, "Trade already settled");

        tradeAgreements[tradeId].isSettled = true;
        balances[tradeAgreements[tradeId].seller] += tradeAgreements[tradeId].price;

        emit TradeSettled(tradeId);
    }

    function withdrawBalance() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "No balance to withdraw");

        balances[msg.sender] = 0;
        payable(msg.sender).transfer(amount);
    }

    function getEnergyListing(uint256 listingId) external view returns (
        address owner,
        euint32 encryptedEnergyAmount,
        uint256 pricePerUnit,
        uint256 timestamp,
        bool isActive,
        uint32 decryptedEnergyAmount,
        bool isDecrypted
    ) {
        require(listingId < nextListingId, "Invalid listing ID");
        EnergyListing storage listing = energyListings[listingId];

        return (
            listing.owner,
            listing.encryptedEnergyAmount,
            listing.pricePerUnit,
            listing.timestamp,
            listing.isActive,
            listing.decryptedEnergyAmount,
            listing.isDecrypted
        );
    }

    function getTradeAgreement(uint256 tradeId) external view returns (
        address buyer,
        address seller,
        uint256 price,
        uint256 timestamp,
        bool isSettled
    ) {
        require(tradeId < nextTradeId, "Invalid trade ID");
        TradeAgreement storage trade = tradeAgreements[tradeId];

        return (
            trade.buyer,
            trade.seller,
            trade.price,
            trade.timestamp,
            trade.isSettled
        );
    }

    function getBalance(address user) external view returns (uint256) {
        return balances[user];
    }

    function getTotalListings() external view returns (uint256) {
        return nextListingId - 1;
    }

    function getTotalTrades() external view returns (uint256) {
        return nextTradeId - 1;
    }
}


